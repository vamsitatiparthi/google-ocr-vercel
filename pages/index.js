import { useMemo, useState } from 'react';

export default function Home() {
  const [files, setFiles] = useState([]);
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(0);
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
      setSelected(0);
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

          <div style={{ flex: 1, background: '#111a2c', padding: 16, borderRadius: 8, minHeight: 520 }}>
            <h3 style={{ marginTop: 0 }}>Results</h3>
            {results.length === 0 && <div style={{ opacity: 0.7 }}>No results yet.</div>}

            {results.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16 }}>
                <div style={{ background: '#0e1729', borderRadius: 8, padding: 8, overflow: 'auto', maxHeight: 560 }}>
                  {results.map((r, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelected(idx)}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        border: 'none',
                        background: idx === selected ? '#1a2340' : 'transparent',
                        color: '#e6eefc',
                        padding: '10px 12px',
                        borderRadius: 6,
                        cursor: 'pointer',
                        marginBottom: 6
                      }}
                      title={r.filename}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.filename}</span>
                        <span style={{ opacity: 0.7, fontSize: 12 }}>{r.type || (r.error ? 'error' : '')}</span>
                      </div>
                      {r.error && <div style={{ color: '#ff8080', fontSize: 12 }}>{r.error}</div>}
                    </button>
                  ))}
                </div>

                <ResultPreview result={results[selected]} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ResultPreview({ result }) {
  const content = useMemo(() => {
    if (!result) return { text: '', json: null };
    const raw = result.text || '';
    // Try to parse as JSON if it looks like JSON
    const trimmed = raw.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']')))
      try { return { text: '', json: JSON.parse(raw) }; } catch { /* ignore */ }
    return { text: raw, json: null };
  }, [result]);

  const copyToClipboard = async () => {
    try {
      const s = content.json ? JSON.stringify(content.json, null, 2) : (content.text || '');
      await navigator.clipboard.writeText(s);
      alert('Copied to clipboard');
    } catch {
      alert('Copy failed');
    }
  };

  const downloadAs = (ext) => {
    const filename = (result?.filename || 'output') + (ext.startsWith('.') ? ext : `.${ext}`);
    const data = content.json ? JSON.stringify(content.json, null, 2) : (content.text || '');
    const blob = new Blob([data], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  if (!result) return null;
  return (
    <div style={{ background: '#0e1729', borderRadius: 8, padding: 12, minHeight: 320 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div>
          <strong>{result.filename}</strong>
          <span style={{ opacity: 0.7, marginLeft: 10 }}>{result.type}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={copyToClipboard} style={btnStyle}>Copy</button>
          <button onClick={() => downloadAs('txt')} style={btnStyle}>Download .txt</button>
          {content.json && <button onClick={() => downloadAs('json')} style={btnStyle}>Download .json</button>}
        </div>
      </div>

      {result.error ? (
        <div style={{ color: '#ff8080' }}>{result.error}</div>
      ) : content.json ? (
        <pre style={preStyle}>{JSON.stringify(content.json, null, 2)}</pre>
      ) : (
        <pre style={preStyle}>{content.text?.slice(0, 200000) || ''}</pre>
      )}
    </div>
  );
}

const btnStyle = {
  padding: '8px 12px',
  background: '#2AA876',
  border: 'none',
  borderRadius: 6,
  color: '#fff',
  cursor: 'pointer'
};

const preStyle = {
  whiteSpace: 'pre-wrap',
  margin: 0,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
};
