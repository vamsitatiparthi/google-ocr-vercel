import { useMemo, useState, useEffect } from 'react';

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
      function RichJsonView({ json }) {
        // editable copy of JSON for user customizations
        const [current, setCurrent] = useState(() => JSON.parse(JSON.stringify(json || {})));
        useEffect(() => setCurrent(JSON.parse(JSON.stringify(json || {}))), [json]);

        const parsing = current.parsing_options || {};
        const validation = current.validation || { valid: true, warnings: [] };

        const updateKV = (idx, field, value) => {
          const kv = Array.isArray(current.key_value_pairs) ? [...current.key_value_pairs] : [];
          kv[idx] = { ...(kv[idx] || {}), [field]: value };
          setCurrent(c => ({ ...c, key_value_pairs: kv }));
        };
        const removeKV = (idx) => {
          const kv = Array.isArray(current.key_value_pairs) ? [...current.key_value_pairs] : [];
          kv.splice(idx, 1);
          setCurrent(c => ({ ...c, key_value_pairs: kv }));
        };
        const addKV = () => {
          const kv = Array.isArray(current.key_value_pairs) ? [...current.key_value_pairs] : [];
          kv.push({ key: '', value: '' });
          setCurrent(c => ({ ...c, key_value_pairs: kv }));
        };

        const updateTableCell = (tableIdx, rowIdx, colIdx, value) => {
          const tabs = (current.tables || []).map(t => ({ ...t }));
          const t = tabs[tableIdx];
          if (!t) return;
          t.raw_data = t.raw_data || [];
          t.raw_data[rowIdx] = t.raw_data[rowIdx] || Array(t.columns || 0).fill('');
          t.raw_data[rowIdx][colIdx] = value;
          tabs[tableIdx] = t;
          setCurrent(c => ({ ...c, tables: tabs }));
        };
        const removeTableRow = (tableIdx, rowIdx) => {
          const tabs = (current.tables || []).map(t => ({ ...t }));
          const t = tabs[tableIdx]; if (!t) return;
          t.raw_data = t.raw_data || [];
          t.raw_data.splice(rowIdx, 1);
          tabs[tableIdx] = t; setCurrent(c => ({ ...c, tables: tabs }));
        };
        const addTableRow = (tableIdx) => {
          const tabs = (current.tables || []).map(t => ({ ...t }));
          const t = tabs[tableIdx]; if (!t) return;
          const cols = t.columns || (t.headers ? t.headers.length : (t.raw_data[0] || []).length || 0);
          t.raw_data = t.raw_data || [];
          t.raw_data.push(Array(cols).fill(''));
          tabs[tableIdx] = t; setCurrent(c => ({ ...c, tables: tabs }));
        };
        const updateHeader = (tableIdx, colIdx, value) => {
          const tabs = (current.tables || []).map(t => ({ ...t }));
          const t = tabs[tableIdx]; if (!t) return;
          t.headers = t.headers || Array(t.columns || (t.raw_data[0]||[]).length).fill('');
          t.headers[colIdx] = value;
          tabs[tableIdx] = t; setCurrent(c => ({ ...c, tables: tabs }));
        };
        const removeTable = (tableIdx) => {
          const tabs = (current.tables || []).slice(); tabs.splice(tableIdx,1);
          setCurrent(c => ({ ...c, tables: tabs }));
        };

        const downloadModified = () => {
          downloadBlob(JSON.stringify(current, null, 2), (current.metadata && current.metadata.filename ? current.metadata.filename : 'modified') + '_modified.json');
        };

        return (
          <div>
            <h4 style={{ marginTop: 0 }}>Structured Result (Editable)</h4>

            <div style={{ marginTop: 8 }}>
              <strong>Key / Value Pairs</strong>
              <div style={{ marginTop: 8 }}>
                {(current.key_value_pairs || []).map((kv, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                    <input value={kv.key || ''} onChange={e => updateKV(i, 'key', e.target.value)} placeholder="label" style={{ width: 240, padding: 6 }} />
                    <input value={kv.value || ''} onChange={e => updateKV(i, 'value', e.target.value)} placeholder="value" style={{ flex: 1, padding: 6 }} />
                    <button onClick={() => removeKV(i)} style={{ ...btnStyle, background: '#b33' }}>Remove</button>
                  </div>
                ))}
                <div style={{ marginTop: 8 }}>
                  <button onClick={addKV} style={btnStyle}>Add field</button>
                </div>
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <strong>Tables</strong>
              <div style={{ marginTop: 8 }}>
                {(current.tables || []).map((t, ti) => (
                  <div key={ti} style={{ marginBottom: 12, padding: 8, border: '1px solid #223257', borderRadius: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div><strong>Table {t.table_number || ti+1}</strong> — page: {t.page ?? 'n/a'} — rows: {t.total_rows ?? 'n/a'}</div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => removeTable(ti)} style={{ ...btnStyle, background: '#b33' }}>Delete Table</button>
                      </div>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {(t.headers || Array(t.columns || 0).fill('')).map((h, ci) => (
                          <input key={ci} value={h || ''} onChange={e => updateHeader(ti, ci, e.target.value)} placeholder={`col ${ci+1}`} style={{ padding: 6, minWidth: 120 }} />
                        ))}
                      </div>
                      <div style={{ marginTop: 8 }}>
                        <TableEditor table={t} tableIdx={ti} onCellChange={updateTableCell} onRemoveRow={removeTableRow} onAddRow={addTableRow} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button onClick={downloadModified} style={btnStyle}>Download Modified JSON</button>
              <button onClick={() => downloadBlob(JSON.stringify(current, null, 2), 'structured_preview.json')} style={btnStyle}>Download Preview JSON</button>
            </div>

            <div style={{ marginTop: 12 }}>
              <details>
                <summary>Formatted JSON</summary>
                <pre style={{ ...preStyle, maxHeight: 480, overflow: 'auto' }}>{JSON.stringify(current, null, 2)}</pre>
              </details>
            </div>
          </div>
        );
      }

      function TableEditor({ table, tableIdx, onCellChange, onRemoveRow, onAddRow }) {
        const headers = table.headers || Array(table.columns || 0).fill('');
        const rows = table.raw_data || [];
        return (
          <div style={{ marginTop: 8 }}>
            <div style={{ overflow: 'auto', border: '1px solid #223257', borderRadius: 6 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {headers.map((h, hi) => (
                      <th key={hi} style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #223257' }}>{h}</th>
                    ))}
                    <th style={{ padding: '6px 8px', borderBottom: '1px solid #223257' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, ri) => (
                    <tr key={ri}>
                      {headers.map((_, ci) => (
                        <td key={ci} style={{ padding: '6px 8px', borderBottom: '1px solid #1a2340' }}>
                          <input value={r[ci] ?? ''} onChange={e => onCellChange(tableIdx, ri, ci, e.target.value)} style={{ width: '100%', padding: 6 }} />
                        </td>
                      ))}
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #1a2340' }}>
                        <button onClick={() => onRemoveRow(tableIdx, ri)} style={{ ...btnStyle, background: '#b33' }}>Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 8 }}>
              <button onClick={() => onAddRow(tableIdx)} style={btnStyle}>Add Row</button>
            </div>
          </div>
        );
      }
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

function RichJsonView({ json }) {
  // We only display the new structured JSON shape
  const items = json.items || [];
  const kv = json.key_value_pairs || [];
  const parsing = json.parsing_options || {};
  const validation = json.validation || { valid: true, warnings: [] };
  const [remap, setRemap] = useState(null);
  const [lastAppliedRemap, setLastAppliedRemap] = useState(null);

  // If parsing suggests column roles, allow user to remap columns
  const colRoles = (parsing.suggestions && parsing.suggestions[0] && parsing.suggestions[0].column_roles) || null;
  const headers = json.parsing_options && json.parsing_options.detected_table_type === 'education' ? ['qualification','school','cgpa','year'] : null;

  const applyRemap = (map) => {
    setRemap(map);
    setLastAppliedRemap(map);
  };

  // Remapped rows for preview
  const remappedRows = useMemo(() => {
    if (!remap || !Array.isArray(items)) return items;
    // remap each item based on user mapping (map: target->source index)
    return items.map(it => {
      const out = {};
      Object.keys(remap).forEach(k => {
        const src = remap[k];
        out[k] = Array.isArray(it) ? (it[src] || '') : (it[k] || it[Object.keys(it)[src]] || '');
      });
      return out;
    });
  }, [remap, items]);

  return (
    <div>
      <h4 style={{ marginTop: 0 }}>Structured Result</h4>
      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 8 }}>
        {kv.map(kvItem => (
          <>
            <div style={{ opacity: 0.8 }}>{kvItem.key}</div>
            <div>{String(kvItem.value)}</div>
          </>
        ))}
      </div>

      <div style={{ marginTop: 12 }}>
        <strong>Parsing Options</strong>
        <div style={{ opacity: 0.8, marginTop: 6 }}>{JSON.stringify(parsing, null, 2)}</div>
      </div>

      <div style={{ marginTop: 12 }}>
        <strong>Validation</strong>
        <div style={{ color: validation.valid ? '#8fd19e' : '#ffb3b3' }}>{validation.valid ? 'OK' : 'Warnings'}</div>
        {!validation.valid && <pre style={preStyle}>{JSON.stringify(validation.warnings, null, 2)}</pre>}
      </div>

      {colRoles && (
        <div style={{ marginTop: 12 }}>
          <h4>Column Mapper (suggested)</h4>
          <div style={{ opacity: 0.8 }}>Detected roles: {colRoles.join(', ')}</div>
          <ColumnMapper roles={colRoles} onApply={applyRemap} detectedType={parsing.detected_table_type} />
        </div>
      )}

      {Array.isArray(remappedRows) && remappedRows.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h4>Items (preview)</h4>
          <TableView headers={headers || Object.keys(remappedRows[0] || {})} rows={remappedRows} />
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button onClick={() => exportRemapped(json, lastAppliedRemap)} style={btnStyle}>Export Remapped .json</button>
          </div>
        </div>
      )}

      <details style={{ marginTop: 12 }}>
        <summary>Raw JSON</summary>
        <pre style={preStyle}>{JSON.stringify(json, null, 2)}</pre>
      </details>
    </div>
  );
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
