import { useState } from 'react';

export default function Home() {
  const [files, setFiles] = useState([]);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const onFilesChange = (e) => {
    setFiles(Array.from(e.target.files || []));
  };

  const uploadAndOcr = async () => {
    setError("");
    if (!files.length) {
      setError("Please select at least one file");
      return;
    }
    setLoading(true);
    try {
      const form = new FormData();
      files.forEach((f) => form.append('files', f));
      const res = await fetch('/api/ocr', { method: 'POST', body: form });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setResults(data.results || []);
    } catch (e) {
      setError(e.message || 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0b1220', color: '#e6eefc', padding: '24px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <h1 style={{ marginBottom: 8 }}>Google OCR (Vercel-ready)</h1>
        <p style={{ marginTop: 0, opacity: 0.8 }}>Upload images or PDFs. Images use Google Cloud Vision; PDFs use pdf-parse locally.</p>

        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
          <div style={{ flex: '0 0 320px', background: '#111a2c', padding: 16, borderRadius: 8 }}>
            <h3 style={{ marginTop: 0 }}>Upload</h3>
            <input type="file" multiple onChange={onFilesChange} accept="image/*,application/pdf,.pdf" />
            <button onClick={uploadAndOcr} disabled={loading} style={{ marginTop: 12, padding: '10px 14px', background: '#2AA876', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer' }}>
              {loading ? 'Processing…' : 'Process'}
            </button>
            {error && <div style={{ color: '#ff8080', marginTop: 8 }}>{error}</div>}
          </div>

          <div style={{ flex: 1, background: '#111a2c', padding: 16, borderRadius: 8 }}>
            <h3 style={{ marginTop: 0 }}>Results</h3>
            {results.length === 0 && <div style={{ opacity: 0.7 }}>No results yet.</div>}
            {results.map((r, idx) => (
              <div key={idx} style={{ background: '#0e1729', padding: 12, borderRadius: 8, marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <strong>{r.filename}</strong>
                  <span style={{ opacity: 0.8 }}>{r.type}</span>
                </div>
                {r.error ? (
                  <div style={{ color: '#ff8080' }}>{r.error}</div>
                ) : (
                  <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}>
                    {r.text?.slice(0, 10000) || ''}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
