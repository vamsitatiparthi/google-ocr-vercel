import { promises as fs } from 'fs';
import path from 'path';
import { IncomingForm } from 'formidable';
import vision from '@google-cloud/vision';
import pdfParse from 'pdf-parse';
import { normalizeAmount, normalizeDate, extractKeyValues, extractTables, detectDocumentType, buildInvoiceStructured, buildUniversalStructured, inferLooseValues } from '../../lib/ocr-utils';
import os from 'os';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function parseMultipart(req) {
  // Parse multipart/form-data using formidable and write to OS temp dir
  return new Promise((resolve, reject) => {
    const form = new IncomingForm({ multiples: true, keepExtensions: true, uploadDir: os.tmpdir() });
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      const out = [];
      // Support single file or multiple
      const fileEntries = [];
      for (const k of Object.keys(files || {})) {
        const v = files[k];
        if (Array.isArray(v)) fileEntries.push(...v);
        else fileEntries.push(v);
      }
      for (const f of fileEntries) {
        const filepath = f.filepath || f.path || f.pathName || f.newFilename || f.newname || f.name || f.tempFilePath || f.tmpPath || f.path;
        const originalFilename = f.originalFilename || f.originalName || f.name || f.filename || f.newFilename || f.newname || path.basename(filepath || '') ;
        out.push({ filepath, originalFilename });
      }
      resolve(out);
    });
  });
}

// helpers are provided by lib/ocr-utils.js

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

// helpers delegated to lib/ocr-utils.js

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
  // Always emit the original file entry (no raw text included)
  results.push({ filename: originalFilename, type: 'Original' });

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
          try {
            const [result] = await client.documentTextDetection(filepath);
            text = result?.fullTextAnnotation?.text || (result?.textAnnotations?.[0]?.description ?? '');
            type = 'google-vision';
          } catch (e) {
            // Surface actionable message for billing/permission issues
            const msg = (e?.message || '').toString();
            if (msg.includes('PERMISSION_DENIED') || /billing/i.test(msg)) {
              throw new Error('Google Vision API permission or billing error: ' + msg + '\nEnable billing for your GCP project and ensure the service account has Vision API access.');
            }
            if (msg.includes('Could not load the default credentials')) {
              throw new Error('Google Vision credentials missing. Set GOOGLE_CLOUD_CREDENTIALS or GOOGLE_CLOUD_CREDENTIALS_BASE64 in Vercel environment.');
            }
            throw e;
          }
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

  const nameBase = baseName(originalFilename);

        // Emit parsed JSONs for CSV and PDF
        if (isCsv(originalFilename)) {
          const parsed = csvPreviewJson(text);
          results.push({ filename: `${nameBase}_parsed.json`, type: 'csv-parsed', content: JSON.stringify(parsed) });
        }
        if (isPdf(originalFilename) && meta) {
          results.push({ filename: `${nameBase}_metadata.json`, type: 'pdf-metadata', content: JSON.stringify(meta) });
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
          results.push({ filename: `${nameBase}_structured.json`, type: 'structured', content: JSON.stringify(structured) });

          // Emit invoice-focused JSON when applicable
          const invoice = buildInvoiceStructured(text);
          if (invoice && Object.keys(invoice).length > 1) {
            results.push({ filename: `${nameBase}_invoice.json`, type: 'invoice', content: JSON.stringify(invoice) });
          }

          // Emit universal JSON per user's schema (strict - no raw text)
          const universal = buildUniversalStructured(text, meta || {});
          results.push({ filename: `${nameBase}_universal.json`, type: 'universal', content: JSON.stringify(universal) });
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
