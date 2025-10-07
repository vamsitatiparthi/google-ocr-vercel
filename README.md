# Google OCR (Vercel-ready)

A minimal Next.js app to run OCR using Google Cloud Vision for images and `pdf-parse` for PDFs. Upload files via the UI and view extracted text. Designed to deploy easily on Vercel.

## Tech stack

- Next.js 14 (Pages Router)
- API route at `pages/api/ocr.js`
- Google Cloud Vision via `@google-cloud/vision`
- `pdf-parse` for quick PDF text extraction
- `formidable` for multipart uploads (uploads stored under `/tmp` to be Vercel-compatible)

## Local setup

1) Install Node (LTS) and enable Corepack if needed.

2) Install dependencies:

```bash
npm install
```

3) Configure env variables:

- Copy `.env.example` to `.env.local` and set one of:
  - `GOOGLE_CLOUD_CREDENTIALS` (plain JSON string of the service account) OR
  - `GOOGLE_CLOUD_CREDENTIALS_BASE64` (base64-encoded JSON string)

4) Run dev server:

```bash
npm run dev
```

Open http://localhost:3000 and upload images or PDFs.

## Deploy on Vercel

1) Push this project to a Git repository (GitHub/GitLab/Bitbucket).

2) In Vercel dashboard, create a new project and import the repository.

3) Set Environment Variables under Settings → Environment Variables:

- Either `GOOGLE_CLOUD_CREDENTIALS` with the JSON content of your service account key
  or `GOOGLE_CLOUD_CREDENTIALS_BASE64` with a base64-encoded key.

4) Deploy. The API stores uploads under `/tmp`, which is writable on Vercel serverless.

## Notes

- For production-grade PDF OCR (including tables), consider Google Vision `asyncBatchAnnotateFiles` or Document AI. This starter uses `pdf-parse` for fast, simple extraction.
- Be mindful of GCP billing. Vision API usage is billed by request.

## File structure

- `pages/index.js` — UI for uploading and viewing results
- `pages/api/ocr.js` — OCR API route (images via Vision, PDFs via pdf-parse)
- `.env.example` — sample environment configuration
- `next.config.js` — Next config
- `package.json` — dependencies and scripts
