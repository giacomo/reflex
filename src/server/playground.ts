const SAMPLE_SCHEMA = {
  questions: [
    { name: "sentiment", options: ["positive", "neutral", "negative"], description: "overall tone" },
    { name: "priority", options: ["low", "medium", "high"] },
    { name: "needs_human", options: ["yes", "no"] },
  ],
};

const SAMPLE_STATE =
  "This is the third month my invoice export has been broken and support keeps sending me the same useless macro. I'm about to cancel.";

/**
 * A self-contained test page for POST /decide: no build step, no external
 * resources (fonts, CDN scripts) since this is served directly by reflex's
 * own HTTP server for a local browser, consistent with "no cloud
 * dependency". Lets you edit schema/state, see the exact request body, and
 * send it.
 */
export const PLAYGROUND_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>reflex</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f3f4f6;
    --surface: #ffffff;
    --surface-2: #f8f9fb;
    --border: #e2e4e9;
    --text: #16181d;
    --text-muted: #6b7280;
    --text-faint: #9ca3af;
    --accent: #4f46e5;
    --accent-hover: #4338ca;
    --accent-text: #ffffff;
    --code-bg: #0f1117;
    --code-text: #e5e7eb;
    --ok: #16a34a;
    --ok-bg: #ecfdf3;
    --err: #dc2626;
    --err-bg: #fef2f2;
    --badge-fast-bg: #e0edff;
    --badge-fast-text: #1d4ed8;
    --badge-deep-bg: #f1e6ff;
    --badge-deep-text: #7c3aed;
    --radius: 12px;
    --shadow: 0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06);
    padding-top: env(safe-area-inset-top, 0px);
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #0b0d12;
      --surface: #14161d;
      --surface-2: #1a1d26;
      --border: #262a35;
      --text: #e7e9ee;
      --text-muted: #9aa1af;
      --text-faint: #6b7280;
      --accent: #7c7ff2;
      --accent-hover: #9294f5;
      --accent-text: #0b0d12;
      --code-bg: #0a0b0f;
      --code-text: #d9dce3;
      --ok: #4ade80;
      --ok-bg: rgba(74,222,128,0.12);
      --err: #f87171;
      --err-bg: rgba(248,113,113,0.12);
      --badge-fast-bg: rgba(96,165,250,0.16);
      --badge-fast-text: #93c5fd;
      --badge-deep-bg: rgba(167,139,250,0.16);
      --badge-deep-text: #c4b5fd;
      --shadow: 0 1px 2px rgba(0,0,0,0.3), 0 4px 12px rgba(0,0,0,0.25);
    }
  }

  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 1040px; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }

  header { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1.75rem; }
  .brand { display: flex; align-items: baseline; gap: 0.6rem; }
  .brand .dot { display: inline-block; width: 0.55rem; height: 0.55rem; border-radius: 50%; background: var(--accent); }
  h1 { font-size: 1.3rem; font-weight: 650; margin: 0; letter-spacing: -0.01em; }
  .tagline { color: var(--text-muted); font-size: 0.85rem; }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 1.1rem 1.25rem 1.3rem;
    margin-bottom: 1.1rem;
  }
  .card-title {
    font-size: 0.78rem;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    margin: 0 0 0.7rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .card-title .hint { text-transform: none; font-weight: 400; letter-spacing: 0; opacity: 0.75; }

  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.1rem; }
  @media (max-width: 720px) { .grid { grid-template-columns: 1fr; } }

  label { display: block; font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.35rem; }

  textarea {
    width: 100%;
    resize: vertical;
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 8px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.82rem;
    padding: 0.65rem 0.75rem;
    outline: none;
    transition: border-color 0.15s ease;
  }
  textarea:focus { border-color: var(--accent); }
  #schema { height: 11rem; }
  #state { height: 6.2rem; }
  .field-note { margin: 0.4rem 0 0; font-size: 0.78rem; color: var(--text-faint); }

  pre.code {
    background: var(--code-bg);
    color: var(--code-text);
    padding: 0.9rem 1rem;
    border-radius: 8px;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.8rem;
    margin: 0;
  }
  pre.code:empty::before { content: attr(data-placeholder); color: #6b7280; }

  .actions { display: flex; align-items: center; gap: 0.8rem; margin: 0.2rem 0 1.1rem; }
  button.primary {
    background: var(--accent);
    color: var(--accent-text);
    border: none;
    border-radius: 8px;
    font-size: 0.9rem;
    font-weight: 600;
    padding: 0.6rem 1.3rem;
    cursor: pointer;
    transition: background 0.15s ease, transform 0.05s ease;
  }
  button.primary:hover { background: var(--accent-hover); }
  button.primary:active { transform: scale(0.98); }
  button.primary:disabled { opacity: 0.6; cursor: default; }
  button.primary .spinner { display: none; }
  button.primary.loading .spinner {
    display: inline-block;
    width: 0.75rem; height: 0.75rem;
    border: 2px solid rgba(255,255,255,0.4);
    border-top-color: #fff;
    border-radius: 50%;
    margin-right: 0.45rem;
    vertical-align: -1px;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .status { font-size: 0.85rem; font-weight: 500; padding: 0.3rem 0.7rem; border-radius: 999px; display: none; }
  .status.show { display: inline-block; }
  .status.ok { color: var(--ok); background: var(--ok-bg); }
  .status.err { color: var(--err); background: var(--err-bg); }
  .status.pending { color: var(--text-muted); background: var(--surface-2); }
  .kbd-hint { color: var(--text-faint); font-size: 0.78rem; margin-left: auto; }
  kbd { font-family: inherit; background: var(--surface-2); border: 1px solid var(--border); border-radius: 4px; padding: 0.05rem 0.35rem; font-size: 0.75rem; }

  table { border-collapse: collapse; width: 100%; margin: 0 0 0.9rem; }
  th, td { text-align: left; padding: 0.5rem 0.6rem; font-size: 0.86rem; }
  thead th { color: var(--text-muted); font-weight: 600; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid var(--border); }
  tbody tr:not(:last-child) td { border-bottom: 1px solid var(--border); }
  tbody tr:hover { background: var(--surface-2); }
  .answer { font-weight: 600; }

  .badge { display: inline-block; padding: 0.15rem 0.55rem; border-radius: 999px; font-size: 0.74rem; font-weight: 600; }
  .badge.fast { background: var(--badge-fast-bg); color: var(--badge-fast-text); }
  .badge.deep { background: var(--badge-deep-bg); color: var(--badge-deep-text); }

  .conf-cell { display: flex; align-items: center; gap: 0.5rem; min-width: 6.5rem; }
  .conf-track { flex: 1; height: 5px; border-radius: 999px; background: var(--border); overflow: hidden; max-width: 4.5rem; }
  .conf-fill { height: 100%; border-radius: 999px; background: var(--accent); }
  .conf-value { font-variant-numeric: tabular-nums; font-size: 0.8rem; color: var(--text-muted); min-width: 2.6rem; }

  .summary { display: flex; gap: 1.5rem; flex-wrap: wrap; color: var(--text-muted); font-size: 0.82rem; margin-top: 0.2rem; }
  .summary b { color: var(--text); }

  .empty-state { color: var(--text-faint); font-size: 0.85rem; padding: 0.4rem 0; }
  footer { text-align: center; color: var(--text-faint); font-size: 0.78rem; margin-top: 2rem; }
  footer code { font-family: ui-monospace, monospace; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="brand">
      <span class="dot"></span>
      <h1>reflex</h1>
    </div>
    <div class="tagline">Local test page for <code>POST /decide</code> &mdash; nothing here leaves this machine.</div>
  </header>

  <div class="grid">
    <div class="card">
      <p class="card-title">Schema</p>
      <label for="schema">Named questions, each with a fixed set of allowed answers</label>
      <textarea id="schema" spellcheck="false">${JSON.stringify(SAMPLE_SCHEMA, null, 2)}</textarea>
    </div>
    <div class="card">
      <p class="card-title">State</p>
      <label for="state">Plain text or JSON &mdash; whatever the model should look at</label>
      <textarea id="state" spellcheck="false">${SAMPLE_STATE}</textarea>
      <p class="field-note">Detected automatically: JSON if it starts with <code>{</code> or <code>[</code>, plain text otherwise.</p>
    </div>
  </div>

  <div class="card">
    <p class="card-title">Request body <span class="hint">exactly what gets POSTed to /decide</span></p>
    <pre class="code" id="requestPreview" data-placeholder="..."></pre>
  </div>

  <div class="actions">
    <button class="primary" id="sendBtn"><span class="spinner"></span>Send</button>
    <span class="status" id="statusLine"></span>
    <span class="kbd-hint"><kbd>&#8984;</kbd>/<kbd>Ctrl</kbd>+<kbd>&crarr;</kbd> to send</span>
  </div>

  <div class="card">
    <p class="card-title">Response</p>
    <div id="resultTable"><p class="empty-state">Send a request to see the answers here.</p></div>
    <pre class="code" id="rawResponse" data-placeholder="Raw JSON response will appear here."></pre>
  </div>

  <footer>served locally by <code>reflex serve</code></footer>
</div>

<script>
(function () {
  const schemaEl = document.getElementById('schema');
  const stateEl = document.getElementById('state');
  const previewEl = document.getElementById('requestPreview');
  const statusEl = document.getElementById('statusLine');
  const tableEl = document.getElementById('resultTable');
  const rawEl = document.getElementById('rawResponse');
  const sendBtn = document.getElementById('sendBtn');

  function parseState(text) {
    const trimmed = text.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try { return JSON.parse(trimmed); } catch (e) { return text; }
    }
    return text;
  }

  function buildBody() {
    let schema;
    try {
      schema = JSON.parse(schemaEl.value);
    } catch (e) {
      return { error: 'Invalid schema JSON: ' + e.message };
    }
    return { body: { schema: schema, state: parseState(stateEl.value) } };
  }

  function updatePreview() {
    const result = buildBody();
    previewEl.textContent = result.error ? result.error : JSON.stringify(result.body, null, 2);
  }
  schemaEl.addEventListener('input', updatePreview);
  stateEl.addEventListener('input', updatePreview);
  updatePreview();

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = 'status show' + (kind ? ' ' + kind : '');
  }

  function renderTable(json) {
    if (!json.results || !json.results.length) {
      tableEl.innerHTML = '<p class="empty-state">No results.</p>';
      return;
    }
    const rows = json.results.map(function (r) {
      const hasConf = typeof r.confidence === 'number';
      const pct = hasConf ? Math.round(r.confidence * 100) : 0;
      const confCell = hasConf
        ? '<div class="conf-cell"><div class="conf-track"><div class="conf-fill" style="width:' + pct + '%"></div></div>' +
          '<span class="conf-value">' + r.confidence.toFixed(3) + '</span></div>'
        : '<span class="conf-value">&ndash;</span>';
      return '<tr><td>' + escapeHtml(r.name) + '</td>' +
        '<td class="answer">' + escapeHtml(r.answer) + '</td>' +
        '<td>' + confCell + '</td>' +
        '<td><span class="badge ' + escapeHtml(r.decidedBy) + '">' + escapeHtml(r.decidedBy) + '</span></td>' +
        '<td>' + r.latencyMs + 'ms</td></tr>';
    }).join('');
    tableEl.innerHTML =
      '<table><thead><tr><th>Question</th><th>Answer</th><th>Confidence</th><th>Decided by</th><th>Latency</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<div class="summary"><span>Total <b>' + json.totalLatencyMs + 'ms</b></span>' +
      '<span>Escalation rate <b>' + Math.round(json.escalationRate * 100) + '%</b></span></div>';
  }

  function send() {
    const result = buildBody();
    if (result.error) {
      setStatus(result.error, 'err');
      return;
    }
    setStatus('Sending\\u2026', 'pending');
    sendBtn.classList.add('loading');
    sendBtn.disabled = true;
    rawEl.textContent = '';
    const startedAt = performance.now();
    fetch('/decide', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(result.body),
    }).then(function (res) {
      const elapsed = Math.round(performance.now() - startedAt);
      return res.json().then(function (json) {
        rawEl.textContent = JSON.stringify(json, null, 2);
        if (!res.ok) {
          setStatus('HTTP ' + res.status + ' \\u00b7 ' + elapsed + 'ms', 'err');
          tableEl.innerHTML = '<p class="empty-state">Request failed &mdash; see raw response below.</p>';
          return;
        }
        setStatus('OK \\u00b7 ' + elapsed + 'ms round-trip', 'ok');
        renderTable(json);
      });
    }).catch(function (e) {
      setStatus('Request failed: ' + e.message, 'err');
    }).finally(function () {
      sendBtn.classList.remove('loading');
      sendBtn.disabled = false;
    });
  }

  sendBtn.addEventListener('click', send);
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      send();
    }
  });
})();
</script>
</body>
</html>
`;
