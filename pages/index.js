import { useMemo, useState, useEffect } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4001';

function IconTrash({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 6h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 6v12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 11v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 11v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 6V4h6v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconButton({ onClick, title, color = '#e06c6c', children }) {
  return (
    <button title={title} onClick={onClick} style={{ border: 'none', background: 'transparent', padding: 6, borderRadius: 6, cursor: 'pointer', color }}>
      {children || <IconTrash />}
    </button>
  );
}

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

  const onFilesChange = (e) => setFiles(Array.from(e.target.files || []));

  const uploadAndOcr = async () => {
    setUploadError("");
    if (!files.length) { setUploadError('Please select at least one file'); return; }
    setLoading(true);
    try {
      const form = new FormData();
      // backend expects single file field name 'file'; process first file for parity
      form.append('file', files[0]);
      const res = await fetch(`${API_BASE}/ocr`, { method: 'POST', body: form });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      // Normalize into current UI result format
      const out = [];
      if (data) {
        const filename = files[0]?.name || 'uploaded';
        out.push({ filename, type: 'Raw', content: data.rawText || '' });
        if (data.structuredJSON) out.push({ filename: filename.replace(/\.[^.]+$/, '') + '.json', type: 'JSON', content: JSON.stringify(data.structuredJSON, null, 2) });
      }
      setResults(out);
      setSelected(0);
    } catch (e) {
      setUploadError(e.message || 'Upload failed');
    } finally { setLoading(false); }
  };

  const processEmails = async () => {
    setEmailError(""); setLoading(true); setResults([]);
    try {
      if (!email || !password) throw new Error('Please enter Email and Password / App Password');
      if (!String(email).includes('@')) throw new Error('Please enter a valid email address');
      const d = Number(days) || 1; if (d < 1) throw new Error('Days Back must be at least 1');
      const normalizedProvider = provider && provider.toLowerCase().includes('auto') ? undefined : provider.toLowerCase();
      const body = { email, password, daysBack: d };
      if (normalizedProvider) body.provider = normalizedProvider;
      const res = await fetch(`${API_BASE}/email/scan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      // backend returns { attachments: [...] }
      const atts = data.attachments || [];
      const out = [];
      for (const a of atts) {
        out.push({ filename: a.filename || 'attachment', type: 'Raw', content: a.rawText || '' });
        if (a.structuredJSON) out.push({ filename: (a.filename || 'attachment') + '.json', type: 'JSON', content: JSON.stringify(a.structuredJSON, null, 2) });
      }
      setResults(out);
      setSelected(0);
    } catch (e) { setEmailError(e.message || 'Email processing failed'); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0b1220', color: '#e6eefc', padding: '32px' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        <h1 style={{ marginBottom: 6 }}>Google OCR</h1>
        <p style={{ marginTop: 0, opacity: 0.8 }}>Upload files or fetch email attachments. Images → Vision OCR. PDFs → parsed text. Results appear on the right.</p>

        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
          <div style={{ flex: '0 0 420px', display: 'grid', gap: 16 }}>
            <div style={{ background: '#111a2c', padding: 16, borderRadius: 12 }}>
              <h3 style={{ marginTop: 0, marginBottom: 4 }}>Upload (Manual)</h3>
              <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 8 }}>Select local files. Images → Vision OCR. PDFs → parsed text. Multiple files allowed.</div>
              <input type="file" multiple onChange={onFilesChange} accept="image/*,application/pdf,.pdf" />
              <button onClick={uploadAndOcr} disabled={loading} style={{ marginTop: 12, padding: '10px 14px', background: '#2AA876', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer' }}>{loading ? 'Processing…' : 'Process'}</button>
              {uploadError && <div style={{ color: '#ff8080', marginTop: 8 }}>{uploadError}</div>}
            </div>

            <div style={{ background: '#111a2c', padding: 16, borderRadius: 12 }}>
              <h3 style={{ marginTop: 0, marginBottom: 4 }}>Email Processing (IMAP)</h3>
              <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 8 }}>Fetch recent attachments from your mailbox. Use app passwords where required.</div>
              <label style={{ display: 'block', marginBottom: 6 }}>Email Provider</label>
              <select value={provider} onChange={e => setProvider(e.target.value)} style={{ width: '100%', marginBottom: 8 }}>
                <option>Auto Detect</option><option>Gmail</option><option>Outlook</option><option>Yahoo</option><option>iCloud</option><option>AOL</option><option>Custom</option>
              </select>
              <label style={{ display: 'block', marginBottom: 6 }}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" style={{ width: '100%', marginBottom: 8 }} />
              <label style={{ display: 'block', marginBottom: 6 }}>Password / App Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" style={{ width: '100%', marginBottom: 8 }} />
              <label style={{ display: 'block', marginBottom: 6 }}>Days Back</label>
              <input type="number" min={1} value={days} onChange={e => setDays(e.target.value)} style={{ width: '100%' }} />
              <button onClick={processEmails} disabled={loading} style={{ marginTop: 12, padding: '10px 14px', background: '#2AA876', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer' }}>{loading ? 'Processing…' : 'Fetch & OCR Attachments'}</button>
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
                  <ResultList results={results} selected={selected} onSelect={setSelected} grouped={groupedView} />
                </div>
                <ResultPreview result={results[selected]} allResults={results} />
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

function ResultPreview({ result, allResults = [] }) {
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

  // Find a sibling extracted-text artifact for this file (e.g. name_extracted.txt)
  const extractedSibling = useMemo(() => {
    if (!result || !result.filename) return null;
    const base = baseName(result.filename || '');
    return (allResults || []).find(r => r && r.type === 'extracted-text' && baseName(r.filename || '') === base) || null;
  }, [result, allResults]);

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
          {extractedSibling && (
            <button onClick={() => downloadBlob(extractedSibling.content || '', extractedSibling.filename || 'extracted.txt')} style={btnStyle}>Download extracted .txt</button>
          )}
        </div>
      </div>

      {result.error ? (
        <div style={{ color: '#ff8080' }}>{result.error}</div>
      ) : content.json ? (
        <EditableJsonView initialJson={content.json} type={result.type} filename={result.filename} />
      ) : (
        <pre style={preStyle}>{content.text?.slice(0, 200000) || ''}</pre>
      )}
    </div>
  );
}

function EditableJsonView({ initialJson, type, filename }) {
  const [edited, setEdited] = useState(() => JSON.parse(JSON.stringify(initialJson || {})));
  useEffect(() => setEdited(JSON.parse(JSON.stringify(initialJson || {}))), [initialJson]);

  const applyChange = (newVal) => setEdited(newVal);

  const downloadEdited = () => {
    const name = (filename || 'structured') + '_edited.json';
    downloadBlob(JSON.stringify(edited, null, 2), name);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h4 style={{ margin: 0 }}>Structured Result (Editable)</h4>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={downloadEdited} style={btnStyle}>Download Edited JSON</button>
          <button onClick={() => { setEdited(JSON.parse(JSON.stringify(initialJson || {}))); }} style={{ ...btnStyle, background: '#666' }}>Reset</button>
        </div>
      </div>

      <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
        <EditableJsonEditor value={edited} onChange={applyChange} />
      </div>

      <details style={{ marginTop: 12 }}>
        <summary>Raw JSON</summary>
        <pre style={preStyle}>{JSON.stringify(edited, null, 2)}</pre>
      </details>
    </div>
  );
}

function EditableJsonEditor({ value, onChange }) {
  // value is an object/array/primitive
  const update = (path, newVal) => {
    const clone = JSON.parse(JSON.stringify(value));
    const parts = path.slice();
    let cur = clone;
    for (let i = 0; i < parts.length - 1; i++) {
      cur = cur[parts[i]];
    }
    const last = parts[parts.length - 1];
    cur[last] = newVal;
    onChange(clone);
  };

  const remove = (path) => {
    const clone = JSON.parse(JSON.stringify(value));
    const parts = path.slice();
    let cur = clone;
    for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
    const last = parts[parts.length - 1];
    if (Array.isArray(cur)) cur.splice(last, 1);
    else delete cur[last];
    onChange(clone);
  };

  const addField = (path, key, val) => {
    const clone = JSON.parse(JSON.stringify(value));
    let cur = clone;
    for (let i = 0; i < path.length; i++) cur = cur[path[i]];
    if (Array.isArray(cur)) cur.push(val);
    else cur[key] = val;
    onChange(clone);
  };

  const renameKey = (path, fromKey, toKey) => {
    const clone = JSON.parse(JSON.stringify(value));
    // navigate to parent object
    let parent = clone;
    for (let i = 0; i < path.length; i++) parent = parent[path[i]];
    if (!parent || typeof parent !== 'object' || Array.isArray(parent)) return;
    // avoid overwriting existing key
    if (toKey in parent && toKey !== fromKey) {
      alert('Key already exists: ' + toKey);
      return;
    }
    parent[toKey] = parent[fromKey];
    delete parent[fromKey];
    onChange(clone);
  };

  return (
    <div style={{ background: '#081126', padding: 12, borderRadius: 8 }}>
      <JsonNode node={value} path={[]} onUpdate={update} onRemove={remove} onAdd={addField} onRename={renameKey} />
    </div>
  );
}

function JsonNode({ node, path, onUpdate, onRemove, onAdd }) {
  // showDelete is optional prop; default true
  const showDelete = arguments[0].showDelete !== undefined ? arguments[0].showDelete : true;
  const [expanded, setExpanded] = useState(true);

  // Primitive
  if (node === null || typeof node !== 'object') {
    const str = node === null ? 'null' : String(node);
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input style={{ flex: 1, padding: 6, borderRadius: 6, border: '1px solid #223257', background: 'transparent', color: '#e6eefc' }} value={str} onChange={e => {
          const v = parsePrimitive(e.target.value);
          onUpdate(path, v);
        }} />
        {showDelete && <IconButton title="Delete" onClick={() => onRemove(path)} color="#b84b4b" />}
      </div>
    );
  }

  // Array
  if (Array.isArray(node)) {
    // Special-case arrays of key/value pairs: [{key:'k', value:'v'}, ...]
    const isKvArray = node.length > 0 && node.every(it => it && typeof it === 'object' && !Array.isArray(it) && ('key' in it) && ('value' in it));
    if (isKvArray) {
      return (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>Key/Value Pairs [{node.length}]</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => onAdd(path, null, { key: '', value: '' })} style={btnStyle}>Add</button>
              <IconButton title="Delete array" onClick={() => onRemove(path)} color="#b84b4b" />
            </div>
          </div>
          <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
            {node.map((it, idx) => (
              <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 56px', gap: 8, alignItems: 'center', padding: 8, border: '1px solid #223257', borderRadius: 6 }}>
                <input value={String(it.key ?? '')} onChange={e => onUpdate([...path, idx, 'key'], e.target.value)} style={{ padding: 6, borderRadius: 6, border: '1px solid #223257', background: 'transparent', color: '#e6eefc' }} />
                <input value={String(it.value ?? '')} onChange={e => onUpdate([...path, idx, 'value'], parsePrimitive(e.target.value))} style={{ padding: 6, borderRadius: 6, border: '1px solid #223257', background: 'transparent', color: '#e6eefc' }} />
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <IconButton title="Delete" onClick={() => onRemove([...path, idx])} color="#b84b4b" />
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>Array[{node.length}]</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => onAdd(path, null, '')} style={btnStyle}>Add item</button>
            <IconButton title="Delete array" onClick={() => onRemove(path)} color="#b84b4b" />
          </div>
        </div>
        <div style={{ marginTop: 8, paddingLeft: 8, display: 'grid', gap: 8 }}>
          {node.map((it, idx) => (
            <div key={idx} style={{ padding: 8, border: '1px solid #223257', borderRadius: 6 }}>
              <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>[{idx}]</div>
              <JsonNode node={it} path={[...path, idx]} onUpdate={onUpdate} onRemove={onRemove} onAdd={onAdd} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Object
  const entries = Object.keys(node || {});
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>{expanded ? 'Object' : 'Object (collapsed)'} — {entries.length} keys</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setExpanded(e => !e)} style={btnStyle}>{expanded ? 'Collapse' : 'Expand'}</button>
          <IconButton title="Delete object" onClick={() => onRemove(path)} color="#b84b4b" />
        </div>
      </div>
      {expanded && (
        <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
          {entries.map((k, i) => {
            const child = node[k];
            // Special-case compact key/value objects: { key: 'Label', value: 'V' }
            const isKeyValue = child && typeof child === 'object' && !Array.isArray(child) && ('key' in child) && ('value' in child) && Object.keys(child).length <= 2;
            return (
              <div key={k} style={{ display: 'grid', gridTemplateColumns: '220px 1fr 120px', gap: 8, alignItems: 'center' }}>
                <input value={k} onChange={e => { const newKey = e.target.value || 'unnamed'; if (newKey === k) return; onRename(path, k, newKey); }} style={{ padding: 6, borderRadius: 6, border: '1px solid #223257', background: 'transparent', color: '#e6eefc' }} />

                <div>
                  {isKeyValue ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <input value={String(child.key || '')} onChange={e => onUpdate([...path, k, 'key'], e.target.value)} style={{ padding: 6, borderRadius: 6, border: '1px solid #223257', background: 'transparent', color: '#e6eefc' }} />
                      <input value={String(child.value ?? '')} onChange={e => onUpdate([...path, k, 'value'], parsePrimitive(e.target.value))} style={{ padding: 6, borderRadius: 6, border: '1px solid #223257', background: 'transparent', color: '#e6eefc' }} />
                    </div>
                  ) : (
                    <JsonNode node={node[k]} path={[...path, k]} onUpdate={onUpdate} onRemove={onRemove} onAdd={onAdd} showDelete={false} />
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <IconButton title="Delete field" onClick={() => onRemove([...path, k])} color="#b84b4b" />
                </div>
              </div>
            );
          })}

          <AddField areaPath={path} onAdd={onAdd} />
        </div>
      )}
    </div>
  );
}

function AddField({ areaPath, onAdd }) {
  const [key, setKey] = useState('');
  const [val, setVal] = useState('');
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
      <input placeholder="new key" value={key} onChange={e=>setKey(e.target.value)} style={{ padding: 6, borderRadius: 6, border: '1px solid #223257', background: 'transparent', color: '#e6eefc' }} />
      <input placeholder="value" value={val} onChange={e=>setVal(e.target.value)} style={{ padding: 6, borderRadius: 6, border: '1px solid #223257', background: 'transparent', color: '#e6eefc', flex: 1 }} />
      <button onClick={() => { if (!key) return alert('Please enter a key'); onAdd(areaPath, key, parsePrimitive(val)); setKey(''); setVal(''); }} style={btnStyle}>Add</button>
    </div>
  );
}

function parsePrimitive(s) {
  if (s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === '') return '';
  const n = Number(s);
  if (!Number.isNaN(n) && String(n) === s) return n;
  return s;
}

function ColumnMapper({ roles, detectedType, onApply }) {
  // roles: array of detected roles per column (e.g., ['text','cgpa','year'])
  const [mapping, setMapping] = useState({});
  const targets = detectedType === 'education' ? ['qualification','school','cgpa','year'] : ['description','quantity','unit_price','amount'];

  const handleChange = (target, idx) => {
    setMapping(m => ({ ...m, [target]: Number(idx) }));
  };

  return (
    <div style={{ background: '#0e1729', padding: 10, borderRadius: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 8 }}>
        {targets.map((t, i) => (
          <div key={t} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ width: 160 }}>{t}</div>
            <select onChange={e => handleChange(t, e.target.value)} style={{ flex: 1 }}>
              <option value="">(auto)</option>
              {roles.map((r, idx) => <option key={idx} value={idx}>{idx}: {r}</option>)}
            </select>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
        <button onClick={() => onApply(mapping)} style={btnStyle}>Apply Mapping</button>
        <button onClick={() => { setMapping({}); onApply(null); }} style={{ ...btnStyle, background: '#666' }}>Clear</button>
      </div>
    </div>
  );
}

function exportRemapped(json, mapping) {
  // mapping: target->source index
  try {
    const out = JSON.parse(JSON.stringify(json || {}));
    if (!mapping || !out.items || !Array.isArray(out.items)) {
      // nothing to do; trigger download of original
      downloadBlob(JSON.stringify(out, null, 2), (out.filename || 'structured') + '_remapped.json');
      return;
    }
    // Build remapped items array
    const remapped = out.items.map(it => {
      // if item is array-like, index into it; if object-like, try to grab keys
      const isArr = Array.isArray(it);
      const result = {};
      Object.keys(mapping).forEach(target => {
        const srcIdx = mapping[target];
        if (srcIdx === undefined || srcIdx === null || srcIdx === '') return;
        const v = isArr ? (it[srcIdx] ?? '') : (it[target] ?? Object.values(it)[srcIdx] ?? '');
        result[target] = v;
      });
      return result;
    });
    out.items = remapped;
    downloadBlob(JSON.stringify(out, null, 2), (out.filename || 'structured') + '_remapped.json');
  } catch (e) {
    alert('Export failed: ' + (e && e.message));
  }
}

function downloadBlob(text, filename) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
