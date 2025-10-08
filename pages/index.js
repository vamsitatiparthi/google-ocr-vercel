import { useMemo, useState } from 'react';

export default function Home() {
  const [files, setFiles] = useState([]);
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(0);
  const [groupedView, setGroupedView] = useState(true);
  const [loading, setLoading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [emailError, setEmailError] = useState("");
  // Email processing state
  const [provider, setProvider] = useState('Auto Detect');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [days, setDays] = useState(1);

  const onFilesChange = (e) => {
    setFiles(Array.from(e.target.files || []));
  };

  const processEmails = async () => {
    setEmailError("");
    setLoading(true);
    setResults([]);
    try {
      // Validations
      if (!email || !password) {
        throw new Error('Please enter Email and Password / App Password');
      }
      if (!String(email).includes('@')) {
        throw new Error('Please enter a valid email address');
      }
      const d = Number(days) || 1;
      if (d < 1) {
        throw new Error('Days Back must be at least 1');
      }
      const body = {
        provider,
        email,
        password,
        days: d
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
      setEmailError(e.message || 'Email processing failed');
    } finally {
      setLoading(false);
    }
  };

  const uploadAndOcr = async () => {
    setUploadError("");
    if (!files.length) {
      setUploadError("Please select at least one file");
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
      setSelected(0);
    } catch (e) {
      setUploadError(e.message || 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0b1220', color: '#e6eefc', padding: '32px' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
  <h1 style={{ marginBottom: 6 }}>Google OCR</h1>
        <p style={{ marginTop: 0, opacity: 0.8 }}>Upload files or fetch email attachments. Images use Google Cloud Vision; PDFs use fast serverless parsing. Results appear on the right.</p>

        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
          <div style={{ flex: '0 0 420px', display: 'grid', gap: 16 }}>
            <div style={{ background: '#111a2c', padding: 16, borderRadius: 12 }}>
              <h3 style={{ marginTop: 0, marginBottom: 4 }}>Upload (Manual)</h3>
              <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 8 }}>Select local files. Images → Vision OCR. PDFs → parsed text. Multiple files allowed.</div>
              <input type="file" multiple onChange={onFilesChange} accept="image/*,application/pdf,.pdf" />
              <button onClick={uploadAndOcr} disabled={loading} style={{ marginTop: 12, padding: '10px 14px', background: '#2AA876', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer' }}>
                {loading ? 'Processing…' : 'Process'}
              </button>
              {uploadError && <div style={{ color: '#ff8080', marginTop: 8 }}>{uploadError}</div>}
            </div>

            <div style={{ background: '#111a2c', padding: 16, borderRadius: 12 }}>
              <h3 style={{ marginTop: 0, marginBottom: 4 }}>Email Processing (IMAP)</h3>
              <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 8 }}>Fetch recent attachments from your mailbox. Use app passwords where required.</div>
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
              {emailError && <div style={{ color: '#ff8080', marginTop: 8 }}>{emailError}</div>}
              <div style={{ opacity: 0.7, marginTop: 6, fontSize: 12 }}>Tip: For Gmail/Outlook with 2FA, use an app password.</div>
            </div>
          </div>

          <div style={{ flex: 1, background: '#111a2c', padding: 16, borderRadius: 12, minHeight: 600 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>Results</h3>
              <label style={{ fontSize: 13, opacity: 0.85 }}>
                <input type="checkbox" checked={groupedView} onChange={e=>setGroupedView(e.target.checked)} style={{ marginRight: 6 }} />
                Group by Original
              </label>
            </div>
            {results.length === 0 && <div style={{ opacity: 0.7 }}>No results yet.</div>}

            {results.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 16 }}>
                <div style={{ background: '#0e1729', borderRadius: 8, padding: 8, overflow: 'auto', maxHeight: 680 }}>
                  <ResultList
                    results={results}
                    selected={selected}
                    onSelect={setSelected}
                    grouped={groupedView}
                  />
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

function baseName(name = '') {
  const i = (name || '').lastIndexOf('.');
  return i >= 0 ? name.slice(0, i) : name;
}

function ResultList({ results, selected, onSelect, grouped }) {
  const groups = useMemo(() => {
    const map = new Map();
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const b = baseName(r.filename || '');
      if (!map.has(b)) map.set(b, []);
      map.get(b).push({ idx: i, item: r });
    }
    return map;
  }, [results]);

  if (!grouped) {
    return (
      <div>
        {results.map((r, idx) => (
          <ResultListItem key={idx} r={r} idx={idx} selected={selected} onSelect={onSelect} />
        ))}
      </div>
    );
  }

  // Grouped rendering: first show the Original if present, then others
  const entries = Array.from(groups.entries());
  return (
    <div>
      {entries.map(([groupName, arr]) => {
        const original = arr.find(x => x.item.type === 'Original') || arr[0];
        const children = arr.filter(x => x !== original);
        return (
          <div key={groupName} style={{ marginBottom: 10 }}>
            <ResultListItem r={original.item} idx={original.idx} selected={selected} onSelect={onSelect} bold />
            <div style={{ marginLeft: 10 }}>
              {children.map(({ item, idx }) => (
                <ResultListItem key={idx} r={item} idx={idx} selected={selected} onSelect={onSelect} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ResultListItem({ r, idx, selected, onSelect, bold }) {
  return (
    <button
      onClick={() => onSelect(idx)}
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
        marginBottom: 6,
        fontWeight: bold ? 700 : 500
      }}
      title={r.filename}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.filename}</span>
        <span style={{ opacity: 0.9, fontSize: 12, background: '#223257', padding: '2px 6px', borderRadius: 12 }}>{r.type || (r.error ? 'error' : '')}</span>
      </div>
      {r.error && <div style={{ color: '#ff8080', fontSize: 12 }}>{r.error}</div>}
    </button>
  );
}

function ResultPreview({ result }) {
  const content = useMemo(() => {
    if (!result) return { text: '', json: null };
    // New API uses `content` for JSON artifacts; fall back to `text` for backwards compatibility
    const raw = (result.content !== undefined ? result.content : result.text) || '';
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
        <RichJsonView json={content.json} type={result.type} />
      ) : (
        <pre style={preStyle}>{content.text?.slice(0, 200000) || ''}</pre>
      )}
    </div>
  );
}

function RichJsonView({ json, type }) {
  // If invoice/universal JSON, render key fields and items table
  const isInvoiceLike = type === 'invoice' || (json && (json.document_type === 'invoice' || json.metadata || json.items));
  if (isInvoiceLike) {
    // Support both legacy flat invoice JSON and new universal schema
    const vendor = json.vendor_name || (json.metadata && json.metadata.vendor_name) || null;
    const invoiceNumber = json.invoice_number || (json.metadata && json.metadata.invoice_number) || null;
    const invoiceDate = json.invoice_date || (json.metadata && json.metadata.invoice_date) || null;
    const dueDate = json.due_date || (json.metadata && json.metadata.due_date) || null;
    const subtotal = (json.summary && json.summary.subtotal) || json.subtotal || null;
    const tax = (json.summary && json.summary.tax) || json.tax || null;
    const total = (json.summary && json.summary.total) || json.total || null;
    const items = json.items || (json.orders && json.orders[0] && json.orders[0].items) || [];

    return (
      <div>
        <div style={{ marginBottom: 12 }}>
          <KeyValueRow label="Vendor" value={vendor} />
          <KeyValueRow label="Invoice #" value={invoiceNumber} />
          <KeyValueRow label="Invoice Date" value={invoiceDate} />
          <KeyValueRow label="Due Date" value={dueDate} />
          <KeyValueRow label="Subtotal" value={fmtAmount(subtotal)} />
          <KeyValueRow label="Tax" value={fmtAmount(tax)} />
          <KeyValueRow label="Total" value={fmtAmount(total)} />
        </div>
        {Array.isArray(items) && items.length > 0 && (
          <div>
            <h4 style={{ marginTop: 0 }}>Items</h4>
            <TableView headers={["description","quantity","unit_price","amount"]} rows={items} />
          </div>
        )}
        <details style={{ marginTop: 12 }}>
          <summary>Raw JSON</summary>
          <pre style={preStyle}>{JSON.stringify(json, null, 2)}</pre>
        </details>
      </div>
    );
  }

  // If structured JSON with text_previewer, show fields and the first table nicely
  if (json && json.text_previewer) {
    const fields = json.text_previewer.fields || {};
    const tables = json.text_previewer.tables || [];
    return (
      <div>
        <h4 style={{ marginTop: 0 }}>Detected Fields</h4>
        <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 8 }}>
          {Object.entries(fields).map(([k,v]) => (
            <>
              <div style={{ opacity: 0.8 }}>{k}</div>
              <div style={{ wordBreak: 'break-word' }}>{String(v)}</div>
            </>
          ))}
        </div>
        {tables.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <h4>Detected Table</h4>
            <TableView headers={tables[0].headers || []} rows={tables[0].rows || []} />
          </div>
        )}
        <details style={{ marginTop: 12 }}>
          <summary>Raw JSON</summary>
          <pre style={preStyle}>{JSON.stringify(json, null, 2)}</pre>
        </details>
      </div>
    );
  }

  // Fallback pretty JSON
  return <pre style={preStyle}>{JSON.stringify(json, null, 2)}</pre>;
}

function TableView({ headers, rows }) {
  const keys = headers && headers.length ? headers : Array.from(rows[0] ? Object.keys(rows[0]) : []);
  return (
    <div style={{ overflow: 'auto', border: '1px solid #223257', borderRadius: 8 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {keys.map((h,i)=> (
              <th key={i} style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #223257' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 500).map((r,ri)=> (
            <tr key={ri}>
              {keys.map((k,ki)=> (
                <td key={ki} style={{ padding: '8px 10px', borderBottom: '1px solid #1a2340', verticalAlign: 'top' }}>{String(r[k] ?? '')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KeyValueRow({ label, value }) {
  if (value == null || value === '') return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 8, margin: '4px 0' }}>
      <div style={{ opacity: 0.8 }}>{label}</div>
      <div>{String(value)}</div>
    </div>
  );
}

function fmtAmount(v) {
  if (typeof v !== 'number') return v;
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
