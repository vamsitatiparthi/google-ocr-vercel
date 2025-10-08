// Shared OCR utilities: parsing, heuristics and structured builders
const moneyReGlobal = /([€$₹])?\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g;
const dateReAny = /\b\d{1,4}[\/\-]\d{1,2}[\/\-]\d{1,4}\b/;

function normalizeAmount(s) {
  if (s == null) return undefined;
  const n = String(s).replace(/[^0-9.,-]/g, '').replace(/,(?=\d{3}(\D|$))/g, '').replace(/,/g, '.');
  const v = parseFloat(n);
  return isNaN(v) ? undefined : v;
}

function normalizeDate(s) {
  if (!s) return undefined;
  const t = String(s).trim().replace(/\./g, '/').replace(/-/g, '/');
  const m = t.match(/(\d{1,4})[\/](\d{1,2})[\/](\d{1,4})/);
  if (!m) return undefined;
  let a = m[1], b = m[2], c = m[3];
  if (a.length === 4) { const y = a; a = b; b = c; c = y; }
  if (c.length === 2) c = '20' + c;
  a = a.padStart(2, '0'); b = b.padStart(2, '0');
  return `${c}-${a}-${b}`; // YYYY-MM-DD
}

function extractKeyValues(text = '') {
  const fields = {};
  const lines = (text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const kvRe = /^(?<key>[A-Za-z0-9 _#\/\-\.]+)\s*[:\-]\s*(?<val>.+)$/;
  for (const l of lines) {
    const m = l.match(kvRe);
    if (m && m.groups) {
      const key = m.groups.key.trim();
      const val = m.groups.val.trim();
      if (!fields[key]) fields[key] = val; else {
        let idx = 2; while (fields[`${key}_${idx}`]) idx++; fields[`${key}_${idx}`] = val;
      }
    }
  }
  return { fields, loose: lines.filter(l => !kvRe.test(l)) };
}

function inferLooseValues(loose = [], fields = {}) {
  const inferred = {};
  const dateRe = /(\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b|\b\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\b)/;
  const amountRe = /\$?\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/;
  const invoiceRe = /(invoice\s*#?\s*\w+|#\s*\d{3,})/i;
  let labelIdx = 1;
  for (const line of loose) {
    const l = line.trim();
    if (!fields['Due Date'] && /due date/i.test(l) && dateRe.test(l)) { inferred['Due Date'] = l.match(dateRe)[1]; continue; }
    if (!fields['Date'] && dateRe.test(l)) { inferred['Date'] = l.match(dateRe)[1]; continue; }
    if (!fields['Total'] && /total/i.test(l) && amountRe.test(l)) { inferred['Total'] = l.match(amountRe)[0]; continue; }
    if (!fields['Invoice No'] && invoiceRe.test(l)) { inferred['Invoice No'] = l.match(invoiceRe)[1]; continue; }
    let key = `label_${labelIdx++}`;
    inferred[key] = l;
  }
  return inferred;
}

function extractTables(text = '') {
  const tables = [];
  const blocks = (text || '').split(/\n\s*\n/);
  for (const b of blocks) {
    const lines = b.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    // CSV-like
    if (lines.every(l => l.includes(','))) {
      const headers = lines[0].split(',').map(s => s.trim());
      const rows = lines.slice(1).map(l => l.split(',').map(s => s.trim()));
      const objs = rows.slice(0, 2000).map(r => { const o = {}; r.forEach((v, i) => o[headers[i] || `col_${i+1}`] = v); return o; });
      tables.push({ headers, rows: objs });
      continue;
    }
    const splitCols = (s) => s.split(/\s{2,}/).map(x => x.trim()).filter(x => x.length > 0);
    const splitted = lines.map(splitCols);
    const colCounts = splitted.map(a => a.length);
    const common = colCounts.reduce((a, b) => Math.max(a, b), 0);
    if (common >= 2 && colCounts.filter(c => c >= 2).length >= Math.max(2, Math.floor(lines.length * 0.6))) {
      const headers = splitted[0].length >= 2 ? splitted[0] : Array.from({ length: common }, (_, i) => `col_${i+1}`);
      const dataRows = (headers === splitted[0] ? splitted.slice(1) : splitted).filter(r => r.length >= 1);
      const objs = dataRows.slice(0, 2000).map(r => { const o = {}; r.forEach((v, i) => o[headers[i] || `col_${i+1}`] = v); return o; });
      tables.push({ headers, rows: objs });
    }
  }
  return tables;
}

function detectDocumentType(text = '') {
  const t = (text || '').toLowerCase();
  const candidates = [
    { type: 'Invoice', kws: ['invoice'] },
    { type: 'Bill', kws: ['bill', 'billing statement'] },
    { type: 'Order', kws: ['purchase order', 'sales order', 'order #', 'po #'] },
    { type: 'Receipt', kws: ['receipt', 'paid'] },
    { type: 'Statement', kws: ['statement'] }
  ];
  let best = null; let bestScore = 0;
  for (const c of candidates) {
    let s = 0; for (const k of c.kws) s += (t.match(new RegExp(k, 'g')) || []).length;
    if (s > bestScore) { bestScore = s; best = c.type; }
  }
  return best || 'unknown';
}

function buildInvoiceStructured(text = '') {
  const out = {};
  if (!text || !text.trim()) return out;
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // Vendor heuristics
  const invIdx = lines.findIndex(l => /\b(invoice|bill)\b/i.test(l));
  out.vendor_name = invIdx > 0 ? lines[Math.max(0, invIdx - 1)] : (lines[0] && lines[0].length <= 80 ? lines[0] : undefined);

  // Dates
  for (const l of lines) {
    if (!out.invoice_date && /invoice\s*date/i.test(l) && dateReAny.test(l)) out.invoice_date = normalizeDate(l.match(dateReAny)[0]);
    if (!out.due_date && /due\s*date/i.test(l) && dateReAny.test(l)) out.due_date = normalizeDate(l.match(dateReAny)[0]);
  }
  if (!out.invoice_date) {
    const firstDate = lines.map(l => (l.match(dateReAny) || [])[0]).filter(Boolean)[0];
    if (firstDate) out.invoice_date = normalizeDate(firstDate);
  }

  // Invoice number
  for (const l of lines) {
    const m = l.match(/invoice\s*(number|no\.?|#)?\s*[:\-]?\s*([A-Za-z0-9\-]+)/i);
    if (m && m[2]) { out.invoice_number = m[2]; break; }
    const m2 = l.match(/#\s*([A-Za-z0-9\-]{4,})/); if (m2) { out.invoice_number = m2[1]; break; }
  }

  // Amounts
  for (const l of lines) {
    const arr = l.match(moneyReGlobal) || [];
    if (arr.length) {
      if (!out.subtotal && /sub\s*total/i.test(l)) out.subtotal = normalizeAmount(arr[arr.length - 1]);
      if (!out.tax && /\b(tax|gst|vat)\b/i.test(l)) out.tax = normalizeAmount(arr[arr.length - 1]);
      if (!out.total && /\btotal\b/i.test(l)) out.total = normalizeAmount(arr[arr.length - 1]);
    }
  }
  if (out.total == null) {
    const amounts = (text.match(moneyReGlobal) || []).map(normalizeAmount).filter(v => typeof v === 'number');
    if (amounts.length) out.total = Math.max(...amounts);
  }

  // Items: try to find a header row with qty/description/price/amount
  const headerIdx = lines.findIndex(l => /(qty|quantity)\b/i.test(l) && /(item|description)\b/i.test(l) && /(rate|price)\b/i.test(l));
  const items = [];
  if (headerIdx >= 0) {
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const row = lines[i]; if (!row || /^[-_\s]*$/.test(row)) break;
      let cols = row.includes(',') ? row.split(',').map(s => s.trim()).filter(Boolean) : row.split(/\s{2,}/).map(s => s.trim()).filter(Boolean);
      if (cols.length >= 2) {
        const numeric = cols.map(c => normalizeAmount(c));
        const numIdx = numeric.map((n, idx) => ({ n, idx })).filter(x => typeof x.n === 'number').map(x => x.idx);
        const obj = {};
        if (numIdx.length >= 1) {
          obj.amount = numeric[numIdx[numIdx.length - 1]];
          if (numIdx.length >= 2) obj.quantity = numeric[numIdx[0]];
          const descParts = cols.filter((_, i) => !numIdx.includes(i));
          obj.description = descParts.join(' ');
        } else {
          obj.description = cols.join(' ');
        }
        items.push(obj);
      }
    }
  }
  if (items.length) out.items = items;
  out.raw_text = text;
  return out;
}

function buildUniversalStructured(text = '', meta = {}) {
  // Build according to the requested schema
  const raw_text = text || '';
  const lines = raw_text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // metadata
  const metadata = {
    vendor_name: undefined,
    customer_name: undefined,
    invoice_number: undefined,
    order_number: undefined,
    invoice_date: undefined,
    due_date: undefined,
    ship_date: undefined,
    address: undefined,
    country: undefined,
    currency: undefined
  };

  // key-values + loose inference
  const { fields, loose } = extractKeyValues(raw_text);
  const inferred = inferLooseValues(loose, fields);

  // populate metadata from fields or inferred
  const pick = (k) => fields[k] || inferred[k] || undefined;
  metadata.invoice_number = pick('Invoice') || pick('Invoice No') || pick('Invoice #') || pick('Invoice Number');
  metadata.order_number = pick('Order') || pick('Order No') || pick('PO') || pick('PO #');
  metadata.invoice_date = normalizeDate(pick('Invoice Date') || pick('Date') || pick('Created')) || undefined;
  metadata.due_date = normalizeDate(pick('Due Date')) || undefined;
  metadata.ship_date = normalizeDate(pick('Ship Date') || pick('Shipping Date')) || undefined;
  metadata.currency = (raw_text.match(/\b(USD|EUR|GBP|JPY|INR)\b/) || [])[0] || undefined;

  // vendor / customer detection heuristics
  const topLines = lines.slice(0, 8);
  if (topLines.length) {
    // vendor guess: first non-empty line that isn't 'invoice' etc
    for (const l of topLines) {
      if (!/invoice|bill|statement|receipt|purchase order|po|order/i.test(l) && l.length > 2) { metadata.vendor_name = l; break; }
    }
    // customer guess: look for 'Bill To' or 'Ship To' blocks
    const billIdx = lines.findIndex(l => /bill to/i.test(l));
    if (billIdx >= 0) metadata.customer_name = lines[billIdx + 1] || undefined;
    const shipIdx = lines.findIndex(l => /ship to/i.test(l));
    if (shipIdx >= 0 && !metadata.customer_name) metadata.customer_name = lines[shipIdx + 1] || undefined;
  }

  // Items detection: attempt to detect tables
  const tables = extractTables(raw_text);
  const items = [];
  if (tables.length > 0) {
    // choose the largest table
    let best = tables[0];
    for (const t of tables) if ((t.rows || []).length > (best.rows || []).length) best = t;
    const headers = best.headers || [];
    let idx = 1;
    for (const r of (best.rows || [])) {
      const desc = r.description || r.item || r.name || headers.map(h => r[h]).join(' ');
      const qty = Number(r.quantity || r.qty || r.Qty || r.Q || 0) || undefined;
      const unit_price = normalizeAmount(r.rate || r.price || r.unit_price) || undefined;
      const amount = normalizeAmount(r.amount || r.total || r.extended) || undefined;
      items.push({ item_no: idx++, item_code: r.item_code || r.code || undefined, upc: r.upc || undefined, description: desc || undefined, quantity: qty, unit_price: unit_price, amount: amount });
    }
  } else {
    // simple heuristic: look for lines with pattern: <desc> <qty> <price>
    let idx = 1;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const m = l.match(/(.+)\s+(\d+(?:\.\d+)?)\s+[$€£]?\s*(\d{1,3}(?:[.,]\d{3})*(?:\.\d{2})?)/);
      if (m) {
        const desc = m[1].trim();
        const qty = Number(m[2]);
        const unit_price = normalizeAmount(m[3]);
        const amount = unit_price != null && qty != null ? unit_price * qty : undefined;
        items.push({ item_no: idx++, item_code: undefined, upc: undefined, description: desc, quantity: qty, unit_price: unit_price, amount });
      }
    }
  }

  // Summary extraction
  let subtotal = undefined, tax = undefined, total = undefined;
  for (const l of lines) {
    const m = (l.match(moneyReGlobal) || []);
    if (m.length) {
      if (/subtotal/i.test(l)) subtotal = normalizeAmount(m[m.length - 1]);
      else if (/tax|gst|vat/i.test(l)) tax = normalizeAmount(m[m.length - 1]);
      else if (/total|amount due|grand total/i.test(l)) total = normalizeAmount(m[m.length - 1]);
    }
  }
  // fallback: largest number is total
  if (total == null) {
    const allNums = (raw_text.match(moneyReGlobal) || []).map(normalizeAmount).filter(v => typeof v === 'number');
    if (allNums.length) total = Math.max(...allNums);
  }

  const summary = { subtotal: subtotal || undefined, tax: tax || undefined, total: total || undefined };

  // other_details
  const other_details = {
    terms: pick('Terms') || pick('Payment Terms') || undefined,
    payment_method: pick('Payment Method') || undefined,
    freight_terms: pick('Freight') || pick('Freight Terms') || undefined,
    carrier: pick('Carrier') || undefined,
    shipping_notes: pick('Shipping Notes') || undefined
  };

  // build key_value_pairs
  const kv = [];
  for (const k of Object.keys(fields)) kv.push({ key: k, value: fields[k] });
  for (const k of Object.keys(inferred)) kv.push({ key: k, value: inferred[k] });

  // document type
  let docType = 'unknown';
  const dt = detectDocumentType(raw_text).toLowerCase();
  if (dt.includes('invoice')) docType = 'invoice';
  else if (dt.includes('bill')) docType = 'bill';
  else if (dt.includes('receipt')) docType = 'receipt';
  else if (dt.includes('order') || dt.includes('po')) docType = 'purchase_order';
  else if (dt.includes('pick') || dt.includes('packing')) docType = 'pick_ticket';
  else if (dt.includes('statement')) docType = 'statement';

  return {
    document_type: docType,
    metadata,
    items,
    summary,
    other_details,
    key_value_pairs: kv
  };
}

module.exports = {
  normalizeAmount,
  normalizeDate,
  extractKeyValues,
  extractTables,
  detectDocumentType,
  buildInvoiceStructured,
  buildUniversalStructured,
  inferLooseValues,
};
