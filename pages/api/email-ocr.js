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
    return { type: 'pdf-parse', text: pdf.text || '' };
  }
  if (isImage(filename)) {
    const [result] = await client.textDetection({ image: { content: buf } });
    const text = result?.fullTextAnnotation?.text || (result?.textAnnotations?.[0]?.description ?? '');
    return { type: 'google-vision', text };
  }
  if (isText(filename)) {
    return { type: 'text', text: buf.toString('utf-8') };
  }
  if (isCsv(filename)) {
    return { type: 'csv', text: buf.toString('utf-8') };
  }
  return { type: 'unknown', text: '' };
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
          const { type, text } = await ocrBuffer(visionClient, content, filename);
          results.push({ filename, type, text });
        } catch (e) {
          results.push({ filename, error: e.message || 'Failed to process attachment' });
        }
        // Keep total results reasonable
        if (results.length >= 20) break;
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
