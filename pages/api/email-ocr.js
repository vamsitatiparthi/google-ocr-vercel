import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import vision from '@google-cloud/vision';
import pdfParse from 'pdf-parse';
import { normalizeAmount, normalizeDate, extractKeyValues, extractTables, detectDocumentType, buildInvoiceStructured, buildUniversalStructured, inferLooseValues } from '../../lib/ocr-utils';

export const config = {
  api: {
    bodyParser: true,
  },
};

function mapProvider(provider, email) {
  const p = (provider || '').toLowerCase().trim();
  // Auto-detect from email domain
  const domainFromEmail = (email || '').split('@').pop()?.toLowerCase() || '';
  if (!p || p === 'auto detect' || p === 'auto') {
    if (domainFromEmail.includes('gmail')) return { host: 'imap.gmail.com', port: 993, secure: true };
    if (domainFromEmail.includes('outlook') || domainFromEmail.includes('hotmail') || domainFromEmail.includes('live')) return { host: 'outlook.office365.com', port: 993, secure: true };
    if (domainFromEmail.includes('yahoo')) return { host: 'imap.mail.yahoo.com', port: 993, secure: true };
    if (domainFromEmail.includes('icloud') || domainFromEmail.includes('me.com')) return { host: 'imap.mail.me.com', port: 993, secure: true };
    if (domainFromEmail.includes('aol')) return { host: 'imap.aol.com', port: 993, secure: true };
    return { host: `imap.${domainFromEmail}`, port: 993, secure: true };
  }
  // Explicit provider names
  if (p === 'gmail') return { host: 'imap.gmail.com', port: 993, secure: true };
  if (p === 'outlook' || p === 'office365') return { host: 'outlook.office365.com', port: 993, secure: true };
  if (p === 'yahoo') return { host: 'imap.mail.yahoo.com', port: 993, secure: true };
  if (p === 'icloud') return { host: 'imap.mail.me.com', port: 993, secure: true };
  if (p === 'aol') return { host: 'imap.aol.com', port: 993, secure: true };
  // Last-resort fallback
  return { host: `imap.${domainFromEmail}`, port: 993, secure: true };
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
      const msg = (e?.message || '').toString();
      if (msg.includes('PERMISSION_DENIED') || /billing/i.test(msg)) {
        throw new Error('Google Vision API permission or billing error: ' + msg + '\nEnable billing for your GCP project and ensure the service account has Vision API access.');
      }
      if (msg.includes('Could not load the default credentials')) {
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
          results.push({ filename, type: 'Original' });

          const { type, text, meta } = await ocrBuffer(visionClient, content, filename);

          // Emit extracted text as a generated file name only as internal step; do not include raw text in API response
          const nameBase = baseName(filename);

          // For CSV, also emit parsed JSON preview
          if (isCsv(filename)) {
            const parsed = csvPreviewJson(text || content.toString('utf-8'));
            const jsonName = `${nameBase}_parsed.json`;
            results.push({ filename: jsonName, type: 'csv-parsed', content: JSON.stringify(parsed) });
          }
          // For PDF, also emit metadata JSON (separate from structured/invoice)
          if (isPdf(filename) && meta) {
            const pdfJsonName = `${nameBase}_metadata.json`;
            results.push({ filename: pdfJsonName, type: 'pdf-metadata', content: JSON.stringify(meta) });
          }

          // For any attachment with text, emit a structured JSON for better understanding
          if (text && text.trim().length > 0) {
            const docType = detectDocumentType(text);
            const { fields, loose } = extractKeyValues(text);
            const inferred = inferLooseValues(loose, fields);
            const tables = extractTables(text);
            const structured = {
              document_type: docType || null,
              pages: meta?.numpages ?? undefined,
              info: meta?.info ?? undefined,
              text_previewer: {
                fields: { ...fields, ...inferred },
                tables
              }
            };
            const structuredName = `${nameBase}_structured.json`;
            results.push({ filename: structuredName, type: 'structured', content: JSON.stringify(structured) });

            // Build invoice-specific JSON if invoice/bill-like content detected
            const invoice = buildInvoiceStructured(text);
            if (invoice && Object.keys(invoice).length > 1) {
              const invoiceName = `${nameBase}_invoice.json`;
              results.push({ filename: invoiceName, type: 'invoice', content: JSON.stringify(invoice) });
            }

            // Emit universal JSON per user's schema
            const universal = buildUniversalStructured(text, meta || {});
            const universalName = `${nameBase}_universal.json`;
            results.push({ filename: universalName, type: 'universal', content: JSON.stringify(universal) });
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
