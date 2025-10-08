import { promises as fs } from 'fs';
import path from 'path';
import { IncomingForm } from 'formidable';
import vision from '@google-cloud/vision';
import pdfParse from 'pdf-parse';
import os from 'os';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function parseMultipart(req) {
  // On Vercel, only /tmp is writable
  const uploadsDir = path.join(os.tmpdir(), 'uploads');
  await fs.mkdir(uploadsDir, { recursive: true });
  const form = new IncomingForm({ multiples: true, uploadDir: uploadsDir, keepExtensions: true });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      let list = files.files;
      if (!list) return resolve([]);
      if (!Array.isArray(list)) list = [list];
      resolve(list.map(f => ({ filepath: f.filepath, originalFilename: f.originalFilename || path.basename(f.filepath) })));
    });
  });
}

// Build invoice/bill structured JSON from raw OCR text
function buildInvoiceStructured(text = '') {
  const out = {};
  if (!text || !text.trim()) return out;
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // Vendor name heuristic: first non-empty line before 'invoice' or 'bill'
  const invIdx = lines.findIndex(l => /\b(invoice|bill)\b/i.test(l));
  if (invIdx > 0) out.vendor_name = lines[Math.max(0, invIdx - 1)];
  else if (lines[0] && lines[0].length <= 64) out.vendor_name = lines[0];

  // Dates
  const dateRe = /(\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b|\b\d{4}[\/-]\d{1,2}[\/-]\d{1,2}\b)/;
  const normDate = (s)=>{
    if(!s) return undefined; const p = s.replace(/\./g,'/').replace(/-/g,'/');
    const parts = p.split('/');
    if (parts.length===3) {
      let [a,b,c]=parts.map(x=>x.padStart(2,'0'));
      if (c.length===2) c = '20'+c; // 2-digit year
      // If YYYY/MM/DD, swap to MM/DD/YYYY
      if (a.length===4) { const y=a; a=b; b=c; c=y; }
      return `${c}-${a}-${b}`; // YYYY-MM-DD
    }
    return s;
  };
  for (const l of lines) {
    if (!out.invoice_date && /invoice\s*date/i.test(l) && dateRe.test(l)) out.invoice_date = normDate(l.match(dateRe)[1]);
    if (!out.due_date && /due\s*date/i.test(l) && dateRe.test(l)) out.due_date = normDate(l.match(dateRe)[1]);
  }
  if (!out.invoice_date) {
    const firstDate = lines.map(l => (l.match(dateRe)||[])[1]).filter(Boolean)[0];
    if (firstDate) out.invoice_date = normDate(firstDate);
  }

  // Invoice number
  const invNoRe = /(invoice\s*(number|no\.?|#)\s*[:\-]?\s*([A-Za-z0-9\-]+))|(\b#\s*([A-Za-z0-9\-]{4,}))|(\binvoice\b\s*([A-Za-z0-9\-]{4,}))/i;
  for (const l of lines) {
    const m = l.match(invNoRe);
    if (m && !out.invoice_number) out.invoice_number = (m[3] || m[5] || m[7] || '').replace(/^#\s*/, '');
  }

  // Amounts
  const moneyRe = /\$?\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/;
  const toFloat = (s)=>{ if(!s) return undefined; const n=s.replace(/[$,\s]/g,''); const v=parseFloat(n); return isNaN(v)?undefined:v; };
  for (const l of lines) {
    if (out.subtotal==null && /\bsub\s*total\b/i.test(l) && moneyRe.test(l)) out.subtotal = toFloat(l.match(moneyRe)[0]);
    if (out.tax==null && /\b(tax|gst|vat)\b/i.test(l) && moneyRe.test(l)) out.tax = toFloat(l.match(moneyRe)[0]);
    if (out.total==null && /\btotal\b/i.test(l) && moneyRe.test(l)) out.total = toFloat(l.match(moneyRe)[0]);
  }
  if (out.total == null) {
    const amounts = lines.flatMap(l => (l.match(new RegExp(moneyRe,'g'))||[])).map(toFloat).filter(v=>typeof v==='number');
    if (amounts.length) out.total = Math.max(...amounts);
  }

  // Items
  let items = [];
  const headerIdx = lines.findIndex(l => /(qty|quantity)\b/i.test(l) && /(item|description)\b/i.test(l) && /(rate|price)\b/i.test(l) && /amount\b/i.test(l));
  if (headerIdx >= 0) {
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const row = lines[i];
      if (!row || /^[-_\s]*$/.test(row)) break;
      let cols = row.includes(',') ? row.split(',').map(s=>s.trim()).filter(Boolean) : row.split(/\s{2,}/).map(s=>s.trim()).filter(Boolean);
      if (cols.length >= 3) {
        const nums = cols.map(c=>toFloat(c));
        const numIdx = nums.map((n,idx)=>({n,idx})).filter(x=>typeof x.n==='number').map(x=>x.idx);
        let obj = {};
        if (numIdx.length >= 2) {
          const [qIdx, ...rest] = numIdx;
          const amountIdx = rest[rest.length-1];
          const rateIdx = rest.length>1 ? rest[0] : undefined;
          obj.quantity = nums[qIdx];
          if (rateIdx!=null) obj.rate = nums[rateIdx];
          obj.amount = nums[amountIdx];
          const descParts = cols.filter((_,i)=> i!==qIdx && i!==rateIdx && i!==amountIdx);
          obj.description = descParts.join(' ');
        } else {
          obj.description = cols[0];
          obj.quantity = toFloat(cols[1]);
          obj.rate = toFloat(cols[2]);
          obj.amount = toFloat(cols[3] || '');
        }
        if (obj.description || obj.amount!=null) items.push(obj);
      } else if (items.length) {
        items[items.length-1].description = (items[items.length-1].description? items[items.length-1].description+' ' : '') + row;
      }
      if (items.length >= 2000) break;
    }
  }
  if (items.length) out.items = items;
  out.raw_text = text;
  return out;
}

function isPdf(filename = '') {
  return filename.toLowerCase().endsWith('.pdf');
}
function isImage(name = '') {
  const n = name.toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.bmp', '.tiff', '.webp', '.gif'].some(ext => n.endsWith(ext));
}
function isText(name = '') { return name.toLowerCase().endsWith('.txt'); }
function isCsv(name = '') { return name.toLowerCase().endsWith('.csv'); }

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

function extractKeyValues(text = '') {
  const fields = {};
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const kvRe = /^(?<key>[A-Za-z0-9 _#\/\-\.]+)\s*[:\-]\s*(?<val>.+)$/;
  const loose = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(kvRe);
    if (m && m.groups) {
      let key = m.groups.key.trim();
      let val = m.groups.val.trim();
      if (!fields[key]) fields[key] = val; else { let idx = 2; while (fields[`${key}_${idx}`]) idx++; fields[`${key}_${idx}`] = val; }
    } else {
      loose.push(lines[i]);
    }
  }
  return { fields, loose };
}

function inferLooseValues(loose = [], fields = {}) {
  const inferred = {};
  const dateRe = /(\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b|\b\d{4}[\/-]\d{1,2}[\/-]\d{1,2}\b)/;
  const amountRe = /\$?\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/;
  const invoiceRe = /(invoice\s*#?\s*\w+|#\s*\d{3,})/i;
  let labelIdx = 1;
  for (const line of loose) {
    const l = line.trim();
    if (!fields['Due Date'] && /due date/i.test(l) && dateRe.test(l)) { inferred['Due Date'] = l.match(dateRe)[1]; continue; }
    if (!fields['Date'] && dateRe.test(l)) { inferred['Date'] = l.match(dateRe)[1]; continue; }
    if (!fields['Total'] && /total/i.test(l) && amountRe.test(l)) { inferred['Total'] = l.match(amountRe)[0]; continue; }
    if (!fields['Invoice No'] && invoiceRe.test(l)) { inferred['Invoice No'] = l.match(invoiceRe)[1]; continue; }
    // fallback generic label
    let key = `label_${labelIdx++}`;
    inferred[key] = l;
  }
  return inferred;
}

function extractTables(text = '') {
  const tables = [];
  const blocks = text.split(/\n\s*\n/);
  for (const b of blocks) {
    const lines = b.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    if (lines.every(l => l.includes(','))) {
      const headers = lines[0].split(',').map(s => s.trim());
      const rows = lines.slice(1).map(l => l.split(',').map(s => s.trim()));
      const objs = rows.slice(0, 2000).map(r => { const o = {}; r.forEach((v,i)=> o[headers[i] || `col_${i+1}`]=v); return o; });
      tables.push({ name: 'table', headers, rows: objs });
      continue;
    }
    const splitCols = (s) => s.split(/\s{2,}/).map(x => x.trim()).filter(x => x.length>0);
    const splitted = lines.map(splitCols);
    const colCounts = splitted.map(a=>a.length);
    const commonCols = colCounts.reduce((a,b)=> b>1?Math.max(a,b):a, 0);
    if (commonCols >= 2 && colCounts.filter(c=>c>=2).length >= Math.max(2, Math.floor(lines.length*0.6))) {
      const headers = splitted[0].length>=2 ? splitted[0] : Array.from({length: commonCols}, (_,i)=>`col_${i+1}`);
      const dataRows = (headers===splitted[0] ? splitted.slice(1) : splitted).filter(r=>r.length>=1);
      const objs = dataRows.slice(0,2000).map(r=>{ const o={}; r.forEach((v,i)=>o[headers[i]||`col_${i+1}`]=v); return o; });
      tables.push({ name: 'table', headers, rows: objs });
    }
  }
  return tables;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  try {
    const files = await parseMultipart(req);
    if (!files || files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

    // Initialize Google Vision client with credentials from environment
    // Prefer GOOGLE_CLOUD_CREDENTIALS (plain JSON) or GOOGLE_CLOUD_CREDENTIALS_BASE64 (base64-encoded JSON)
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
    } catch (e) {
      // ignore; will fallback to ADC if running locally with gcloud auth
    }
    const client = new vision.ImageAnnotatorClient(clientOptions);

    const results = [];
    for (const file of files) {
      const { filepath, originalFilename } = file;
      try {
        // Always emit the original file entry
        results.push({ filename: originalFilename, type: 'Original', text: '' });

        let text = '';
        let type = '';
        let meta = undefined;
        if (isPdf(originalFilename)) {
          const data = await fs.readFile(filepath);
          const pdf = await pdfParse(data);
          text = pdf.text || '';
          type = 'pdf-parse';
          meta = { numpages: pdf.numpages || undefined, info: pdf.info || undefined, text_preview: (text||'').slice(0,2000) };
        } else if (isImage(originalFilename)) {
          const [result] = await client.documentTextDetection(filepath);
          text = result?.fullTextAnnotation?.text || (result?.textAnnotations?.[0]?.description ?? '');
          type = 'google-vision';
        } else if (isText(originalFilename)) {
          const data = await fs.readFile(filepath, 'utf-8');
          text = data;
          type = 'text';
        } else if (isCsv(originalFilename)) {
          const data = await fs.readFile(filepath, 'utf-8');
          text = data;
          type = 'csv';
        } else {
          const data = await fs.readFile(filepath);
          text = data.toString('utf-8');
          type = 'binary';
        }

        // Emit extracted text file name
        const nameBase = baseName(originalFilename);
        const extractedName = `${nameBase}_extracted.txt`;
        results.push({ filename: extractedName, type, text });

        // Emit parsed JSONs for CSV and PDF
        if (isCsv(originalFilename)) {
          const parsed = csvPreviewJson(text);
          results.push({ filename: `${nameBase}_parsed.json`, type: 'csv-parsed', text: JSON.stringify(parsed) });
        }
        if (isPdf(originalFilename) && meta) {
          results.push({ filename: `${nameBase}_parsed.json`, type: 'pdf-parsed', text: JSON.stringify(meta) });
        }

        // Emit structured JSON for any text content
        if (text && text.trim().length > 0) {
          const { fields, loose } = extractKeyValues(text);
          const inferred = inferLooseValues(loose, fields);
          const tables = extractTables(text);
          const docType = detectDocumentType(text);
          const structured = {
            document_type: docType || null,
            pages: meta?.numpages ?? undefined,
            info: meta?.info ?? undefined,
            text_preview: (text||'').slice(0,2000),
            text_previewer: {
              fields: { ...fields, ...inferred },
              tables
            }
          };
          results.push({ filename: `${nameBase}_structured.json`, type: 'structured', text: JSON.stringify(structured) });

          // Emit invoice-focused JSON when applicable
          const invoice = buildInvoiceStructured(text);
          if (invoice && Object.keys(invoice).length > 1) {
            results.push({ filename: `${nameBase}_invoice.json`, type: 'invoice', text: JSON.stringify(invoice) });
          }
        }
      } catch (e) {
        results.push({ filename: originalFilename, error: e.message || 'Failed to process' });
      } finally {
        // Cleanup uploaded temp file
        try { await fs.unlink(filepath); } catch {}
      }
    }

    res.status(200).json({ results });
  } catch (e) {
    res.status(500).json({ error: e.message || 'OCR failed' });
  }
}
