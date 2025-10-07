import { useState } from 'react';

export default function Home() {
  const [files, setFiles] = useState([]);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Email processing state
  const [provider, setProvider] = useState('Auto Detect');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [days, setDays] = useState(1);

  const onFilesChange = (e) => {
    setFiles(Array.from(e.target.files || []));
  };

  const processEmails = async () => {
    setError("");
    setLoading(true);
    setResults([]);
    try {
      const body = {
        provider,
        email,
        password,
        days: Number(days) || 1
      };
      const res = await fetch('/api/email-ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setResults(data.results || []);
    } catch (e) {
      setError(e.message || 'Email processing failed');
    } finally {
      setLoading(false);
    }
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
        <p style={{ marginTop: 0, opacity: 0.8 }}>Upload images or PDFs, or fetch mail attachments. Images use Google Cloud Vision; PDFs use pdf-parse locally.</p>

        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
          <div style={{ flex: '0 0 360px', display: 'grid', gap: 16 }}>
            <div style={{ background: '#111a2c', padding: 16, borderRadius: 8 }}>
              <h3 style={{ marginTop: 0 }}>Upload</h3>
              <input type="file" multiple onChange={onFilesChange} accept="image/*,application/pdf,.pdf" />
              <button onClick={uploadAndOcr} disabled={loading} style={{ marginTop: 12, padding: '10px 14px', background: '#2AA876', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer' }}>
                {loading ? 'Processing…' : 'Process'}
              </button>
            </div>

            <div style={{ background: '#111a2c', padding: 16, borderRadius: 8 }}>
              <h3 style={{ marginTop: 0 }}>Email Processing</h3>
              <label style={{ display: 'block', marginBottom: 6 }}>Email Provider</label>
              <select value={provider} onChange={e => setProvider(e.target.value)} style={{ width: '100%', marginBottom: 8 }}>
                <option>Auto Detect</option>
                <option>Gmail</option>
                <option>Outlook</option>
                <option>Yahoo</option>
                <option>iCloud</option>
                <option>AOL</option>
                <option>Custom</option>
              </select>
              <label style={{ display: 'block', marginBottom: 6 }}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" style={{ width: '100%', marginBottom: 8 }} />
              <label style={{ display: 'block', marginBottom: 6 }}>Password / App Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" style={{ width: '100%', marginBottom: 8 }} />
              <label style={{ display: 'block', marginBottom: 6 }}>Days Back</label>
              <input type="number" min={1} value={days} onChange={e => setDays(e.target.value)} style={{ width: '100%' }} />
              <button onClick={processEmails} disabled={loading} style={{ marginTop: 12, padding: '10px 14px', background: '#2AA876', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer' }}>
                {loading ? 'Processing…' : 'Fetch & OCR Attachments'}
              </button>
              <div style={{ opacity: 0.7, marginTop: 6, fontSize: 12 }}>Tip: For Gmail/Outlook with 2FA, use an app password.</div>
            </div>

            {error && <div style={{ color: '#ff8080' }}>{error}</div>}
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
