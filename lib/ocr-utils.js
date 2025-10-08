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
  // Universal structured JSON per user's schema
  const raw_text = text || '';
  const lines = raw_text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const metadata = {
    numpages: meta?.numpages ?? undefined,
    producer: meta?.info?.Producer || meta?.info?.producer || undefined,
    created_at: normalizeDate((meta?.info?.CreationDate || '').replace(/^D:/, '')) || undefined
  };

  // Key-values
  const { fields, loose } = extractKeyValues(raw_text);
  const inferred = inferLooseValues(loose, fields);
  const kvPairs = [];
  for (const k of Object.keys(fields)) kvPairs.push({ key: k, value: fields[k] });
  for (const k of Object.keys(inferred)) kvPairs.push({ key: k, value: inferred[k] });

  // Tables / items
  const tables = extractTables(raw_text);
  const items = [];
  // Try to normalize first table as items if headers look like qty/description/price/amount
  if (tables.length > 0) {
    const t = tables[0];
    // t.rows are objects keyed by header
    for (const r of (t.rows || [])) {
      const it = {
        item_code: r.item_code || r.code || r.sku || undefined,
        upc: r.upc || undefined,
        description: r.description || r.item || r.name || Object.values(r).slice(0,1).join(' '),
        quantity: (r.quantity != null) ? Number(r.quantity) : (r.qty != null ? Number(r.qty) : undefined),
        rate: (r.rate != null) ? normalizeAmount(r.rate) : (r.price != null ? normalizeAmount(r.price) : undefined),
        amount: (r.amount != null) ? normalizeAmount(r.amount) : undefined
      };
      items.push(it);
    }
  }

  // Detect numbers and currency amounts across entire text
  const moneyMatches = (raw_text.match(moneyReGlobal) || []).map(normalizeAmount).filter(v => typeof v === 'number');
  const totalGuess = moneyMatches.length ? Math.max(...moneyMatches) : undefined;

  // Document-level fields
  const docType = (detectDocumentType(raw_text) || 'unknown').toLowerCase().replace(/\s+/g, '_');
  // Guess vendor: line above first 'invoice'/'bill'/'statement' or first short line
  let vendor_name;
  const invIdx = lines.findIndex(l => /\b(invoice|bill|statement|order|receipt)\b/i.test(l));
  if (invIdx > 0) vendor_name = lines[Math.max(0, invIdx - 1)];
  else if (lines[0] && lines[0].length <= 120) vendor_name = lines[0];

  // Dates and numbers scanning
  const dateRe = /(\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b|\b\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\b)/g;
  let invoice_date, due_date, ship_date, invoice_number, order_number;
  for (const l of lines) {
    // invoice/order numbers
    const invMatch = l.match(/\b(invoice|inv)\s*(?:no\.?|#|:)\s*([A-Za-z0-9\-]{3,})/i) || l.match(/\b#\s*([A-Za-z0-9\-]{4,})/);
    if (invMatch && !invoice_number) invoice_number = invMatch[invMatch.length - 1];
    const ordMatch = l.match(/\b(?:SO|SO#|SO-|Order|Order#|PO|PO#)\s*[:#-]?\s*([A-Za-z0-9\-]+)/i);
    if (ordMatch) {
      if (!order_number) order_number = ordMatch[1];
    }
    // dates
    const dMatch = l.match(dateRe);
    if (dMatch) {
      for (const d of dMatch) {
        const nd = normalizeDate(d);
        if (!invoice_date && /invoice\s*date/i.test(l)) invoice_date = nd;
        if (!due_date && /due\s*date|terms/i.test(l)) due_date = nd;
        if (!ship_date && /ship\s*date|ship date|shipdate/i.test(l)) ship_date = nd;
        if (!invoice_date && !due_date && !ship_date && !invoice_date) invoice_date = invoice_date || nd;
      }
    }
  }

  // Amount heuristics
  let subtotal, tax, total, currency;
  for (const l of lines) {
    const m = (l.match(moneyReGlobal) || []);
    if (m.length) {
      if (!currency) {
        const c = l.match(/[€$₹]/); if (c) currency = c[0];
      }
      if (!subtotal && /sub\s*total/i.test(l)) subtotal = normalizeAmount(m[m.length - 1]);
      if (!tax && /\b(tax|gst|vat)\b/i.test(l)) tax = normalizeAmount(m[m.length - 1]);
      if (!total && /\b(total|amount due)\b/i.test(l)) total = normalizeAmount(m[m.length - 1]);
    }
  }
  if (total == null) total = totalGuess;

  // Build orders array
  const orders = [];
  if (order_number || invoice_number) {
    orders.push({
      order_number: order_number || null,
      po_number: null,
      customer: { name: null, address: null, country: null },
      freight_terms: null,
      carrier: null,
      ship_via: null,
      shipping_notes: null,
      items: items.length ? items : undefined,
      total: total || undefined
    });
  }

  const out = {
    metadata,
    document_type: (docType === 'invoice' || docType === 'bill' || docType === 'pick ticket' || docType === 'order' || docType === 'statement') ? docType : (docType === 'unknown' ? 'unknown' : docType),
    document_summary: {
      vendor_name: vendor_name || undefined,
      invoice_number: invoice_number || undefined,
      order_number: order_number || undefined,
      invoice_date: invoice_date || undefined,
      due_date: due_date || undefined,
      ship_date: ship_date || undefined,
      subtotal: subtotal || undefined,
      tax: tax || undefined,
      total: total || undefined,
      currency: currency || undefined
    },
    orders: orders,
    key_value_pairs: kvPairs,
    unstructured_values: loose.filter(l => !(Object.values(fields).includes(l) || Object.values(inferred).includes(l))),
    raw_text
  };
  return out;
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
