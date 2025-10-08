import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import vision from '@google-cloud/vision';
import pdfParse from 'pdf-parse';

export const config = {
  api: {
    bodyParser: true,
  },
};

function mapProvider(provider, email) {
  const p = (provider || '').toLowerCase();
  if (!p || p === 'auto detect' || p === 'auto') {
    const domain = (email || '').split('@').pop()?.toLowerCase() || '';
    if (domain.includes('gmail')) return { host: 'imap.gmail.com', port: 993, secure: true };
    if (domain.includes('outlook') || domain.includes('hotmail') || domain.includes('live')) return { host: 'outlook.office365.com', port: 993, secure: true };
    if (domain.includes('yahoo')) return { host: 'imap.mail.yahoo.com', port: 993, secure: true };
    if (domain.includes('icloud') || domain.includes('me.com')) return { host: 'imap.mail.me.com', port: 993, secure: true };
    if (domain.includes('aol')) return { host: 'imap.aol.com', port: 993, secure: true };
    return { host: `imap.${domain}`, port: 993, secure: true };
  }

// Build invoice/bill structured JSON from raw OCR text
function buildInvoiceStructured(text = '') {
  const out = {};
  if (!text || !text.trim()) return out;
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // Vendor name heuristic: first non-empty line before a line that contains 'invoice' or 'bill'
  const invIdx = lines.findIndex(l => /\b(invoice|bill)\b/i.test(l));
  if (invIdx > 0) {
    out.vendor_name = lines[Math.max(0, invIdx - 1)];
  } else {
    // Fallback to the very first line as vendor/company if it looks like a name
    if (lines[0] && lines[0].length <= 64) out.vendor_name = lines[0];
  }

  // Dates
  const dateRe = /(\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b|\b\d{4}[\/-]\d{1,2}[\/-]\d{1,2}\b)/;
  for (const l of lines) {
    if (!out.invoice_date && /invoice\s*date/i.test(l) && dateRe.test(l)) out.invoice_date = l.match(dateRe)[1];
    if (!out.due_date && /due\s*date/i.test(l) && dateRe.test(l)) out.due_date = l.match(dateRe)[1];
  }
  if (!out.invoice_date) {
    const firstDate = lines.map(l => (l.match(dateRe)||[])[1]).filter(Boolean)[0];
    if (firstDate) out.invoice_date = firstDate;
  }

  // Invoice number
  const invNoRe = /(invoice\s*(number|no\.?|#)\s*[:\-]?\s*([A-Za-z0-9\-]+))|(\b#\s*([A-Za-z0-9\-]{4,}))|(\binvoice\b\s*([A-Za-z0-9\-]{4,}))/i;
  for (const l of lines) {
    const m = l.match(invNoRe);
    if (m && !out.invoice_number) {
      out.invoice_number = (m[3] || m[5] || m[7] || '').replace(/^#\s*/, '');
    }
  }

  // Amounts
  const moneyRe = /\$?\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/;
  function toFloat(s){ if(!s) return undefined; const n = s.replace(/[$,\s]/g,''); const v=parseFloat(n); return isNaN(v)?undefined:v; }
  for (const l of lines) {
    if (!out.subtotal && /\bsub\s*total\b/i.test(l) && moneyRe.test(l)) out.subtotal = toFloat(l.match(moneyRe)[0]);
    if (!out.tax && /\b(tax|gst|vat)\b/i.test(l) && moneyRe.test(l)) out.tax = toFloat(l.match(moneyRe)[0]);
    if (!out.total && /\btotal\b/i.test(l) && moneyRe.test(l)) out.total = toFloat(l.match(moneyRe)[0]);
  }
  // If multiple amounts exist and total missing, choose largest as total
  if (out.total == null) {
    const amounts = lines.flatMap(l => (l.match(new RegExp(moneyRe,'g'))||[])).map(toFloat).filter(v=>typeof v==='number');
    if (amounts.length) out.total = Math.max(...amounts);
  }

  // Items table: look for a header line with quantity/item/rate/amount
  let items = [];
  const headerIdx = lines.findIndex(l => /(qty|quantity)\b/i.test(l) && /(item|description)\b/i.test(l) && /(rate|price)\b/i.test(l) && /amount\b/i.test(l));
  if (headerIdx >= 0) {
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const row = lines[i];
      if (!row || /^[-_\s]*$/.test(row)) break;
      // Try CSV split first then space-aligned
      let cols = row.includes(',') ? row.split(',').map(s=>s.trim()).filter(Boolean) : row.split(/\s{2,}/).map(s=>s.trim()).filter(Boolean);
      if (cols.length >= 3) {
        // Heuristic mapping
        let obj = {};
        // If numeric-col present, assign quantity/rate/amount
        const nums = cols.map(c=>toFloat(c));
        const numIdx = nums.map((n,idx)=>({n,idx})).filter(x=>typeof x.n==='number').map(x=>x.idx);
        // description assumed as the first non-numeric or middle chunk
        if (numIdx.length >= 2) {
          const [qIdx, ...rest] = numIdx;
          const amountIdx = rest[rest.length-1];
          const rateIdx = rest.length>1? rest[0] : undefined;
          obj.quantity = nums[qIdx];
          if (rateIdx!=null) obj.rate = nums[rateIdx];
          obj.amount = nums[amountIdx];
          // description combines remaining string parts
          const descParts = cols.filter((_,i)=> i!==qIdx && i!==rateIdx && i!==amountIdx);
          obj.description = descParts.join(' ');
        } else {
          // fallback positional
          obj.description = cols[0];
          obj.quantity = toFloat(cols[1]);
          obj.rate = toFloat(cols[2]);
          obj.amount = toFloat(cols[3] || '');
        }
        // Only push if something meaningful exists
        if (obj.description || obj.amount!=null) items.push(obj);
      } else {
        // Single value line: append to last description
        if (items.length) items[items.length-1].description = (items[items.length-1].description? items[items.length-1].description+' ' : '') + row;
      }
      if (items.length >= 2000) break;
    }
  }
  if (items.length) out.items = items;
  out.raw_text = text;
  return out;
}

// Heuristic document type detection from text
function detectDocumentType(text = '') {
  const t = text.toLowerCase();
  const candidates = [
    { type: 'Invoice', kws: ['invoice'] },
    { type: 'Bill', kws: ['bill', 'billing statement'] },
    { type: 'Pick Ticket', kws: ['pick ticket', 'picking list'] },
    { type: 'Order', kws: ['purchase order', 'sales order', 'order #', 'order no', 'po #'] },
    { type: 'Payment', kws: ['payment', 'receipt', 'paid'] },
    { type: 'Statement', kws: ['statement of account', 'statement'] },
    { type: 'Delivery Note', kws: ['delivery note', 'delivery order', 'pod'] },
  ];
  let best = null, bestScore = 0;
  for (const c of candidates) {
    let s = 0; for (const k of c.kws) s += (t.match(new RegExp(k, 'g')) || []).length;
    if (s > bestScore) { bestScore = s; best = c.type; }
  }
  return best;
}

// Extract simple key:value pairs from text lines
function extractKeyValues(text = '') {
  const fields = {};
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const kvRe = /^(?<key>[A-Za-z0-9 _#\/\-\.]+)\s*[:\-]\s*(?<val>.+)$/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(kvRe);
    if (m && m.groups) {
      let key = m.groups.key.trim();
      let val = m.groups.val.trim();
      if (!fields[key]) fields[key] = val; else {
        // de-duplicate keys by suffixing index
        let idx = 2; while (fields[`${key}_${idx}`]) idx++; fields[`${key}_${idx}`] = val;
      }
    }
  }
  return fields;
}

// Naive table extraction from text: detect comma or multi-space separated blocks
function extractTables(text = '') {
  const tables = [];
  const blocks = text.split(/\n\s*\n/); // paragraph-like blocks
  for (const b of blocks) {
    const lines = b.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    // CSV-like
    if (lines.every(l => l.includes(','))) {
      const headers = lines[0].split(',').map(s => s.trim());
      const rows = lines.slice(1).map(l => l.split(',').map(s => s.trim()));
      const objs = rows.slice(0, 2000).map(r => {
        const o = {}; r.forEach((v, i) => o[headers[i] || `col_${i+1}`] = v); return o;
      });
      tables.push({ name: 'table', headers, rows: objs });
      continue;
    }
    // Space-aligned columns (very naive): split by 2+ spaces and require >=2 cols
    const splitCols = (s) => s.split(/\s{2,}/).map(x => x.trim()).filter(x => x.length > 0);
    const splitted = lines.map(splitCols);
    const colCounts = splitted.map(a => a.length);
    const commonCols = colCounts.reduce((a,b)=> b>1?Math.max(a,b):a, 0);
    if (commonCols >= 2 && colCounts.filter(c => c>=2).length >= Math.max(2, Math.floor(lines.length*0.6))) {
      const headers = splitted[0].length>=2 ? splitted[0] : Array.from({length: commonCols}, (_,i)=>`col_${i+1}`);
      const dataRows = (headers===splitted[0] ? splitted.slice(1) : splitted).filter(r => r.length >= 1);
      const objs = dataRows.slice(0, 2000).map(r => {
        const o = {}; r.forEach((v,i)=> o[headers[i] || `col_${i+1}`]=v); return o;
      });
      tables.push({ name: 'table', headers, rows: objs });
    }
  }
  return tables;
}
  if (p === 'gmail') return { host: 'imap.gmail.com', port: 993, secure: true };
  if (p === 'outlook') return { host: 'outlook.office365.com', port: 993, secure: true };
  if (p === 'yahoo') return { host: 'imap.mail.yahoo.com', port: 993, secure: true };
  if (p === 'icloud') return { host: 'imap.mail.me.com', port: 993, secure: true };
  if (p === 'aol') return { host: 'imap.aol.com', port: 993, secure: true };
  // Custom: try imap.domain
  const domain = (email || '').split('@').pop()?.toLowerCase() || '';
  return { host: `imap.${domain}`, port: 993, secure: true };
}

function isImage(name = '') {
  const n = name.toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.bmp', '.tiff', '.webp', '.gif'].some(ext => n.endsWith(ext));
}
function isPdf(name = '') { return name.toLowerCase().endsWith('.pdf'); }
function isText(name = '') { return name.toLowerCase().endsWith('.txt'); }
function isCsv(name = '') { return name.toLowerCase().endsWith('.csv'); }

async function ocrBuffer(client, buf, filename) {
  if (isPdf(filename)) {
    const pdf = await pdfParse(buf);
    const meta = {
      numpages: pdf.numpages || undefined,
      info: pdf.info || undefined,
      text_preview: (pdf.text || '').slice(0, 2000)
    };
    return { type: 'pdf-parse', text: pdf.text || '', meta };
  }
  if (isImage(filename)) {
    try {
      const [result] = await client.documentTextDetection({ image: { content: buf } });
      const text = result?.fullTextAnnotation?.text || (result?.textAnnotations?.[0]?.description ?? '');
      return { type: 'google-vision', text };
    } catch (e) {
      // Surface a clearer hint when credentials are missing
      if ((e?.message || '').includes('Could not load the default credentials')) {
        throw new Error('Google Vision credentials missing. Set GOOGLE_CLOUD_CREDENTIALS or GOOGLE_CLOUD_CREDENTIALS_BASE64 in Vercel environment.');
      }
      throw e;
    }
  }
  if (isText(filename)) {
    return { type: 'text', text: buf.toString('utf-8') };
  }
  if (isCsv(filename)) {
    return { type: 'csv', text: buf.toString('utf-8') };
  }
  return { type: 'unknown', text: '' };
}

function baseName(name = '') {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(0, i) : name;
}

function csvPreviewJson(csvText) {
  try {
    const lines = csvText.split(/\r?\n/).filter(l => l.length > 0);
    if (lines.length === 0) return { headers: [], rows: [] };
    const split = (line) => line.split(',');
    const headers = split(lines[0]).map(h => h.trim());
    const rows = [];
    for (let i = 1; i < Math.min(lines.length, 2001); i++) {
      const cols = split(lines[i]).map(c => c.trim());
      const obj = {};
      for (let j = 0; j < cols.length; j++) {
        const key = headers[j] || `col_${j+1}`;
        obj[key] = cols[j];
      }
      rows.push(obj);
    }
    return { headers, row_count: lines.length - 1, rows_preview_count: rows.length, rows };
  } catch {
    return { headers: [], rows: [] };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  const { provider, email, password, days = 1 } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  // Initialize Google Vision
  let clientOptions = undefined;
  try {
    const jsonPlain = process.env.GOOGLE_CLOUD_CREDENTIALS;
    const jsonB64 = process.env.GOOGLE_CLOUD_CREDENTIALS_BASE64;
    let credsObj = null;
    if (jsonPlain) {
      credsObj = JSON.parse(jsonPlain);
    } else if (jsonB64) {
      const decoded = Buffer.from(jsonB64, 'base64').toString('utf-8');
      credsObj = JSON.parse(decoded);
    }
    if (credsObj) {
      clientOptions = {
        projectId: credsObj.project_id,
        credentials: {
          client_email: credsObj.client_email,
          private_key: credsObj.private_key,
        },
      };
    }
  } catch {}
  const visionClient = new vision.ImageAnnotatorClient(clientOptions);

  // IMAP settings
  const imapCfg = mapProvider(provider, email);
  const client = new ImapFlow({
    host: imapCfg.host,
    port: imapCfg.port,
    secure: imapCfg.secure,
    auth: { user: email, pass: password },
    logger: false,
  });

  let closeNeeded = false;
  const results = [];
  try {
    await client.connect();
    closeNeeded = true;
    await client.mailboxOpen('INBOX');

    // Search by SINCE date; also limit total messages to avoid timeouts
    const since = new Date(Date.now() - (Number(days) || 1) * 24 * 60 * 60 * 1000);
    const sequence = await client.search({ since });
    // Process newest first, up to 10 emails to stay within serverless limits
    const toProcess = sequence.slice(-10).reverse();

    for (const uid of toProcess) {
      // Fetch structure and envelope
      const msg = await client.fetchOne(uid, { source: true });
      const parsed = await simpleParser(msg.source);
      const attachments = parsed.attachments || [];
      for (const att of attachments) {
        const filename = att.filename || 'attachment';
        const content = att.content; // Buffer
        try {
          // Always emit the original as a list item (no content to preview)
          results.push({ filename, type: 'Original', text: '' });

          const { type, text, meta } = await ocrBuffer(visionClient, content, filename);

          // Emit extracted text as a generated file name
          const nameBase = baseName(filename);
          const extractedName = `${nameBase}_extracted.txt`;
          if (text && text.length > 0) {
            results.push({ filename: extractedName, type, text });
          } else {
            results.push({ filename: extractedName, type, text: '' });
          }

          // For CSV, also emit parsed JSON preview
          if (isCsv(filename)) {
            const parsed = csvPreviewJson(text || content.toString('utf-8'));
            const jsonName = `${nameBase}_parsed.json`;
            results.push({ filename: jsonName, type: 'csv-parsed', text: JSON.stringify(parsed) });
          }
          // For PDF, also emit parsed JSON metadata
          if (isPdf(filename) && meta) {
            const pdfJsonName = `${nameBase}_parsed.json`;
            results.push({ filename: pdfJsonName, type: 'pdf-parsed', text: JSON.stringify(meta) });
          }

          // For any attachment with text, emit a structured JSON for better understanding
          if (text && text.trim().length > 0) {
            const docType = detectDocumentType(text);
            const fields = extractKeyValues(text);
            const tables = extractTables(text);
            const structured = {
              document_type: docType || null,
              pages: meta?.numpages ?? undefined,
              info: meta?.info ?? undefined,
              text_preview: (text || '').slice(0, 2000),
              // As requested: keep a section named 'text_previewer' with key-values and tables
              text_previewer: {
                fields,
                tables
              }
            };
            const structuredName = `${nameBase}_structured.json`;
            results.push({ filename: structuredName, type: 'structured', text: JSON.stringify(structured) });

            // Build invoice-specific JSON if invoice/bill-like content detected
            const invoice = buildInvoiceStructured(text);
            if (invoice && Object.keys(invoice).length > 1) {
              const invoiceName = `${nameBase}_invoice.json`;
              results.push({ filename: invoiceName, type: 'invoice', text: JSON.stringify(invoice) });
            }
          }
        } catch (e) {
          results.push({ filename, error: e.message || 'Failed to process attachment' });
        }
        // Keep total results reasonable
        if (results.length >= 40) break; // allow more since we emit multiple per attachment
      }
      if (results.length >= 20) break;
    }

    return res.status(200).json({ results });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to process emails' });
  } finally {
    if (closeNeeded) {
      try { await client.logout(); } catch {}
    }
  }
}
