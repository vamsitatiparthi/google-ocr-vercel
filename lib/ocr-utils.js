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
    // keep both raw and trimmed lines; replace NBSP and tabs with spaces
    const rawLines = b.split(/\r?\n/).map(l => l.replace(/\u00A0/g, ' ').replace(/\t/g, ' ')).filter(Boolean);
    const lines = rawLines.map(l => l.trim()).filter(Boolean);
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
    const maxCols = colCounts.reduce((a, b) => Math.max(a, b), 0);
    // require at least some rows having 2+ columns to consider tabular
    if (maxCols >= 2 && colCounts.filter(c => c >= 2).length >= Math.max(1, Math.floor(lines.length * 0.4))) {
      // attempt to find a header row via header-like keywords first
      const headerKeywords = ['qualification', 'school', 'college', 'year', 'cgpa', 'description', 'item', 'qty', 'quantity', 'price', 'amount', 'total', 'rate', 'name'];
      let headerIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        const rowLower = lines[i].toLowerCase();
        if (headerKeywords.some(k => rowLower.includes(k))) { headerIdx = i; break; }
      }
      // fallback: choose header row as the first row with the maximum number of columns
      if (headerIdx < 0) headerIdx = colCounts.findIndex(c => c === maxCols);
      if (headerIdx < 0) headerIdx = 0;

      // smart header splitting: if header tokens are not split well (e.g., single token), try token-level splitting and reserve rightmost tokens for year/CGPA
      let headers = [];
      const headerTokens = (splitted[headerIdx] || []).slice();
      if (headerTokens.length >= 2) {
        headers = headerTokens;
      } else {
        // build header from raw header line using token heuristics
        const rawHeader = rawLines[headerIdx] || lines[headerIdx] || '';
        const tokens = rawHeader.split(/\s+/).map(t => t.trim()).filter(Boolean);
        // helper patterns for rightmost columns
        const yearRe = /\(?\d{4}(?:[-–]\d{4})?\)?/;
        const cgpaRe = /^\d(?:\.\d+)?$/;
        const reserved = [];
        // take tokens from right that look like year or numeric (CGPA)
        while (tokens.length && reserved.length < maxCols) {
          const tok = tokens[tokens.length - 1];
          if (yearRe.test(tok) || cgpaRe.test(tok) || /\(.*\d{4}.*\)/.test(tok)) {
            reserved.unshift(tok.replace(/[()]/g, ''));
            tokens.pop();
          } else break;
        }
        const remainingSlots = Math.max(0, maxCols - reserved.length);
        const left = [];
        if (remainingSlots <= 1) {
          left.push(tokens.join(' '));
        } else {
          // split left tokens into remainingSlots parts (greedy)
          const approx = Math.ceil(tokens.length / remainingSlots);
          for (let i = 0; i < remainingSlots; i++) {
            const part = tokens.splice(0, approx).join(' ');
            left.push(part);
          }
        }
        headers = [...left, ...reserved].map(h => h || `col_${Math.random().toString(36).slice(2,6)}`);
        if (headers.length < maxCols) {
          // pad
          while (headers.length < maxCols) headers.push(`col_${headers.length+1}`);
        }
      }

      // Preprocess data rows: try to merge wrapped rows where a row has fewer columns than header
      const rawDataSplitted = [];
      // create splitted version aligned to rawLines in case trimming removed meaningful spaces
      for (let i = headerIdx + 1; i < rawLines.length; i++) {
        const ln = rawLines[i].trim();
        if (!ln) continue;
        // prefer splitting by 2+ spaces; fallback to single space tokens
        let parts = ln.split(/\s{2,}/).map(x => x.trim()).filter(Boolean);
        if (parts.length < 2) parts = ln.split(/\s+/).map(x => x.trim()).filter(Boolean);
        rawDataSplitted.push(parts);
      }

      const merged = [];
      for (let i = 0; i < rawDataSplitted.length; i++) {
        let row = rawDataSplitted[i].slice();
        // if row has fewer columns than headers, try to pull following rows that look like continuations
        while (row.length < headers.length && i + 1 < rawDataSplitted.length) {
          const next = rawDataSplitted[i + 1];
          const nextJoined = next.join(' ');
          // if next row looks like a year-only row or starts with '('year')' or is short, attach to last cell
          const looksLikeYearOrParen = /^\(?\d{4}(?:[-–]\d{4})?\)?$/.test(nextJoined) || /^\(.*\d{4}.*\)$/.test(nextJoined);
          const nextHasFewCols = next.length <= 2;
          if (looksLikeYearOrParen || nextHasFewCols) {
            row[row.length - 1] = [row[row.length - 1], next.join(' ')].join(' ');
            i++; // consume next
          } else {
            // if combining current row with next yields >= headers.length columns when splitting by single spaces, try that
            const combined = row.concat(next);
            if (combined.length >= headers.length) { row = combined; i++; }
            else break;
          }
        }
        merged.push(row);
      }

      // map merged rows to objects
      const objs = merged.slice(0, 2000).map(r => { const o = {}; r.forEach((v, i) => o[headers[i] || `col_${i+1}`] = v); return o; });
      tables.push({ headers, rows: objs });
    }
  }
  return tables;
}

// Parse textual "TABLE EXTRACTION SUMMARY" blocks produced by some PDF tools
function parseTableSummaryFromText(text = '') {
  if (!text) return [];
  const tables = [];
  // Find sections starting with "Table <n>:" (case-insensitive)
  const parts = text.split(/(^|\n)(?=Table\s+\d+\s*:)/mi).filter(Boolean);
  for (const p of parts) {
    const mTable = p.match(/Table\s*(\d+)\s*:/i);
    if (!mTable) continue;
    const tableId = Number(mTable[1]);
    const pageMatch = p.match(/Page\s*:\s*(\d+)/i);
    const dimsMatch = p.match(/Dimensions\s*:\s*([0-9]+)\s*rows\s*x\s*([0-9]+)\s*columns/i);
    const headersMatch = p.match(/Headers\s*:\s*([^\n]+)/i);
    const rows = [];
    // Match Row N: {...}
    const rowRe = /Row\s*\d+\s*:\s*(\{[\s\S]*?\})(?=\n|$)/gi;
    let rm;
    while ((rm = rowRe.exec(p)) !== null) {
      let objStr = rm[1];
      try {
        // Convert single quotes to double quotes for JSON parsing
        const jsonLike = objStr.replace(/'/g, '"');
        const parsed = JSON.parse(jsonLike);
        rows.push(parsed);
      } catch (e) {
        // best-effort: attempt to extract key:value pairs with simple regex
        const kv = {};
        const kvRe = /'([^']+)'\s*:\s*'([^']*)'/g;
        let kvm;
        while ((kvm = kvRe.exec(objStr)) !== null) {
          kv[kvm[1]] = kvm[2];
        }
        if (Object.keys(kv).length) rows.push(kv);
      }
    }

    const headers = headersMatch ? headersMatch[1].split(',').map(h => h.trim()) : (rows[0] ? Object.keys(rows[0]) : []);
    const rowCount = dimsMatch ? Number(dimsMatch[1]) : rows.length;
    const colCount = dimsMatch ? Number(dimsMatch[2]) : (headers.length || (rows[0] ? Object.keys(rows[0]).length : 0));
    tables.push({ headers, rows, page: pageMatch ? Number(pageMatch[1]) : null, rowCount, colCount, tableId });
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
  // Prefer any explicit textual table summary if present (e.g., "TABLE EXTRACTION SUMMARY")
  const parsedSummaryTables = parseTableSummaryFromText(raw_text);
  const detectedTables = (parsedSummaryTables && parsedSummaryTables.length) ? parsedSummaryTables : extractTables(raw_text);
  // Build a tables summary for the structured output: include row/col counts, headers and a small preview
  const tables_summary = (detectedTables || []).map((t, ti) => {
    const rowsArr = t.rows || [];
    const headersArr = t.headers || (rowsArr[0] ? Object.keys(rowsArr[0]) : []);
    const rowCount = t.rowCount != null ? t.rowCount : rowsArr.length;
    const colCount = t.colCount != null ? t.colCount : (headersArr.length || (rowsArr[0] ? Object.keys(rowsArr[0]).length : 0));
    const rows_preview = rowsArr.slice(0, 5);
    return {
      table_id: t.tableId || (ti + 1),
      page: t.page || null,
      dimensions: `${rowCount} rows x ${colCount} columns`,
      row_count: rowCount,
      column_count: colCount,
      headers: headersArr,
      rows_preview
    };
  });
  const items = [];
  // helpers for token-type alignment
  const yearRe = /\(?\d{4}(?:[-–]\d{4})?\)?/;
  const cgpaRe = /^\d(?:\.\d+)?$/; // simple cgpa detection

  const alignEducationRow = (tokens, expectedCols) => {
    const t = tokens.map(s => (s || '').toString().trim()).filter(Boolean);
    const out = Array(expectedCols).fill('');
    // find year token (prefer rightmost match)
    let yearIdx = -1;
    for (let i = t.length - 1; i >= 0; i--) if (yearRe.test(t[i])) { yearIdx = i; break; }
    const year = yearIdx >= 0 ? t.splice(yearIdx, 1)[0].replace(/[()]/g, '') : undefined;
    // find cgpa-like token (0-10 float) excluding things that look like years
    let cgpaIdx = -1;
    for (let i = t.length - 1; i >= 0; i--) {
      const v = t[i].replace(/[()]/g, '');
      if (cgpaRe.test(v)) { cgpaIdx = i; break; }
    }
    const cgpa = cgpaIdx >= 0 ? parseFloat(t.splice(cgpaIdx, 1)[0]) : undefined;

    // remaining tokens: qualification and school (combine as needed)
    let qualification = undefined;
    let school = undefined;
    if (t.length === 0) {
      qualification = undefined;
    } else if (t.length === 1) {
      qualification = t[0];
    } else {
      qualification = t[0];
      school = t.slice(1).join(' ');
    }

    // Map into columns: try to fill from left: qualification, school, then cgpa, year
    out[0] = qualification || '';
    if (expectedCols >= 2) out[1] = school || '';
    if (expectedCols >= 3) out[expectedCols - 2] = cgpa == null ? '' : String(cgpa);
    if (expectedCols >= 4) out[expectedCols - 1] = year || '';
    return out;
  };

  const alignGenericRow = (tokens, expectedCols) => {
    const t = tokens.map(s => (s || '').toString().trim()).filter(Boolean);
    const out = Array(expectedCols).fill('');
    // Collect numeric-like tokens to place on the right
    const numericIdxs = [];
    for (let i = 0; i < t.length; i++) {
      const v = t[i].replace(/[,()]/g, '');
      if (!isNaN(Number(v)) || yearRe.test(t[i]) || cgpaRe.test(v)) numericIdxs.push(i);
    }
    // place numeric tokens to rightmost slots
    const rightSlots = expectedCols - Math.min(expectedCols, numericIdxs.length);
    // Build left-over tokens for left side
    const leftTokens = t.filter((_, i) => !numericIdxs.includes(i));
    // fill left side
    for (let i = 0; i < Math.min(leftTokens.length, expectedCols); i++) out[i] = leftTokens[i];
    // fill right side with numeric tokens
    const nums = numericIdxs.map(i => t[i]);
    for (let j = 0; j < nums.length && expectedCols - 1 - j >= 0; j++) {
      out[expectedCols - 1 - j] = nums[nums.length - 1 - j];
    }
    return out;
  };

  const alignRowToHeader = (rowArr, headers, hintType = 'generic') => {
    const expected = Math.max(headers.length, 1);
    if (hintType === 'education') return alignEducationRow(rowArr, expected);
    return alignGenericRow(rowArr, expected);
  };
  const parsing_options = { detected_table_type: null, header_index: null, suggestions: [] };
  if (detectedTables.length > 0) {
    // choose the largest table
    let best = detectedTables[0];
    for (const t of detectedTables) if ((t.rows || []).length > (best.rows || []).length) best = t;
    const headers = best.headers || [];
    let idx = 1;
    // detect if this is an education/qualification table
    const headerText = (headers.join(' ') || '').toLowerCase();
    const firstRowText = ((best.rows || [])[0] && Object.values((best.rows || [])[0]).join(' ')) || '';
    const isEducation = /qualification|school|college|cgpa|year|passing/.test(headerText) || /qualification|school|college|cgpa|year|passing/.test(firstRowText.toLowerCase());
    parsing_options.detected_table_type = isEducation ? 'education' : 'generic';
    // try to record header index suggestion
    parsing_options.header_index = 0;
    // --- column-type voting: inspect each row tokens to guess column roles ---
    const tokenizedRows = (best.rows || []).map(r => Object.values(r).map(v => (v||'').toString().replace(/\u0000/g, '').trim()));
    const colCount = Math.max(headers.length, tokenizedRows.reduce((m, r) => Math.max(m, r.length), 0));
    const votes = Array.from({ length: colCount }, () => ({ year: 0, numeric: 0, cgpa: 0, text: 0 }));
    for (const r of tokenizedRows) {
      for (let c = 0; c < colCount; c++) {
        const v = (r[c] || '').trim();
        if (!v) { votes[c].text++; continue; }
        if (yearRe.test(v)) votes[c].year++; else if (cgpaRe.test(v.replace(/[()]/g, ''))) votes[c].cgpa++; else if (!isNaN(Number(v.replace(/[,()]/g, '')))) votes[c].numeric++; else votes[c].text++;
      }
    }
    // compute role per column by highest vote
    const colRole = votes.map(v => {
      const entries = Object.entries(v).sort((a,b) => b[1] - a[1]);
      return entries[0][0];
    });
    parsing_options.suggestions.push({ column_roles: colRole });
    if (isEducation) {
      for (const r of (best.rows || [])) {
        const rowVals = Object.values(r).map(v => (v || '').toString().replace(/\u0000/g, '').trim());
        // re-map tokens into columns using voting results: prefer education mapping
        const aligned = alignRowToHeader(rowVals, headers, 'education');
        const qualification = aligned[0] || undefined;
        const school = aligned[1] || aligned.slice(1, -1).join(' ') || undefined;
        const last = aligned[aligned.length - 1] || '';
        const yearMatch = (last.match(/(\d{4}(?:[-–]\d{4})?)/) || [])[0];
        // pick cgpa from the column that votes 'cgpa' if present
        let cgpa = undefined;
        for (let ci = 0; ci < aligned.length; ci++) {
          if (colRole[ci] === 'cgpa') { const v = aligned[ci].replace(/[()]/g, ''); if (cgpaRe.test(v)) cgpa = parseFloat(v); }
        }
        // fallback: if not found, search anywhere in aligned
        if (cgpa == null) {
          const gm = (aligned.join(' ').match(/\b(\d(?:\.\d+)?)\b/) || [])[1]; if (gm) cgpa = parseFloat(gm);
        }
        const year = yearMatch || undefined;
        items.push({ item_no: idx++, qualification: qualification || undefined, school: school || undefined, cgpa: cgpa || undefined, year: year || undefined });
      }
    } else {
      for (const r of (best.rows || [])) {
        const rowVals = Object.values(r).map(v => (v || '').toString().replace(/\u0000/g, '').trim());
        // realign generic rows by voting: if rightmost columns voted numeric/year, place numeric tokens there
        const aligned = alignRowToHeader(rowVals, headers, 'generic');
        const desc = aligned.slice(0, Math.max(1, aligned.length - 2)).join(' ') || undefined;
        const qty = Number(aligned[aligned.length - 2]) || undefined;
        const unit_price = normalizeAmount(aligned[aligned.length - 1]) || undefined;
        const amount = unit_price != null && qty != null ? unit_price * qty : undefined;
        items.push({ item_no: idx++, item_code: undefined, upc: undefined, description: desc, quantity: qty, unit_price: unit_price, amount: amount });
      }
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
  // document type (compute early so summary fallback can use it)
  let docType = 'unknown';
  const dt = detectDocumentType(raw_text).toLowerCase();
  if (dt.includes('invoice')) docType = 'invoice';
  else if (dt.includes('bill')) docType = 'bill';
  else if (dt.includes('receipt')) docType = 'receipt';
  else if (dt.includes('order') || dt.includes('po')) docType = 'purchase_order';
  else if (dt.includes('pick') || dt.includes('packing')) docType = 'pick_ticket';
  else if (dt.includes('statement')) docType = 'statement';

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
  if (total == null && docType === 'invoice') {
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

  // normalize common keys into stable names and sanitize values
  const normalizeKey = (k) => {
    const kk = String(k || '').toLowerCase().replace(/[^a-z0-9 ]+/g, '').trim();
    if (/phone|mobile|contact/.test(kk)) return 'phone';
    if (/email/.test(kk)) return 'email';
    if (/date of birth|dob/.test(kk)) return 'date_of_birth';
    if (/nationality/.test(kk)) return 'nationality';
    if (/address/.test(kk)) return 'address';
    if (/qualification|degree|course/.test(kk)) return 'qualification';
    if (/school|college|university/.test(kk)) return 'school';
    if (/cgpa|gpa|grade/.test(kk)) return 'cgpa';
    if (/languages|language/.test(kk)) return 'languages';
    if (/father|parent/.test(kk)) return 'father_name';
    return k;
  };
  // collapse duplicates after normalization and sanitize values
  const kvMap = {};
  for (const e of kv) {
    const rawKey = e.key || '';
    const nk = normalizeKey(rawKey);
    let val = e.value == null ? '' : String(e.value);
    // remove embedded nulls and normalize whitespace
    val = val.replace(/\u0000/g, '').replace(/[\u00A0\t]+/g, ' ').trim();
    if (!kvMap[nk]) kvMap[nk] = val; else {
      kvMap[nk] = Array.isArray(kvMap[nk]) ? [...kvMap[nk], val] : [kvMap[nk], val];
    }
  }
  const normalized_kv = Object.keys(kvMap).map(k => ({ key: k, value: kvMap[k] }));

  const out = {
    document_type: docType,
    metadata,
    items: items || [],
    tables: tables_summary,
    summary: summary || { subtotal: undefined, tax: undefined, total: undefined },
    other_details: other_details || {},
    key_value_pairs: normalized_kv,
    parsing_options
  };
  out.validation = validateStructured(out);
  return out;
}

// quick validator to ensure schema stability and surface warnings
function validateStructured(obj) {
  const warnings = [];
  if (!obj || typeof obj !== 'object') return { valid: false, warnings: ['result is not an object'] };
  if (!Array.isArray(obj.items)) warnings.push('items should be an array');
  if (!obj.summary || typeof obj.summary !== 'object') warnings.push('summary missing or invalid');
  // simple per-item checks
  (obj.items || []).forEach((it, i) => {
    if (!it.description && !it.qualification && !it.description) warnings.push(`item[${i}] missing description/qualification`);
    if (it.quantity != null && typeof it.quantity !== 'number') warnings.push(`item[${i}].quantity is not a number`);
    if (it.unit_price != null && typeof it.unit_price !== 'number') warnings.push(`item[${i}].unit_price is not a number`);
    if (it.cgpa != null) {
      const g = Number(it.cgpa);
      if (isNaN(g) || g < 0 || g > 10) warnings.push(`item[${i}].cgpa looks suspicious: ${it.cgpa}`);
    }
  });
  return { valid: warnings.length === 0, warnings };
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
