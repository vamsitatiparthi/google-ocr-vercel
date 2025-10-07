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

function isPdf(filename = '') {
  return filename.toLowerCase().endsWith('.pdf');
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
        let text = '';
        let type = '';
        if (isPdf(originalFilename)) {
          // Parse PDF text (fast, local) — Vision can be used via asyncBatchAnnotateFiles but slower/complex
          const data = await fs.readFile(filepath);
          const pdf = await pdfParse(data);
          text = pdf.text || '';
          type = 'pdf-parse';
        } else {
          // Image OCR with Vision
          const [result] = await client.textDetection(filepath);
          text = result?.fullTextAnnotation?.text || (result?.textAnnotations?.[0]?.description ?? '');
          type = 'google-vision';
        }
        results.push({ filename: originalFilename, type, text });
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
