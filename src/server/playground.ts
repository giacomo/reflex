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
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>reflex</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; max-width: 960px; margin: 2rem auto; padding: 0 1rem 3rem; line-height: 1.45; }
  h1 { font-size: 1.4rem; margin-bottom: 0.2rem; }
  h3 { font-size: 1rem; margin: 1.2rem 0 0.4rem; }
  textarea { width: 100%; box-sizing: border-box; font-family: ui-monospace, Consolas, monospace; font-size: 0.85rem; padding: 0.5rem; }
  #schema { height: 11rem; }
  #state { height: 5rem; }
  pre { background: rgba(127,127,127,0.12); padding: 0.75rem; border-radius: 6px; overflow-x: auto; white-space: pre-wrap; word-break: break-word; font-size: 0.85rem; }
  button { font-size: 1rem; padding: 0.5rem 1.4rem; cursor: pointer; }
  table { border-collapse: collapse; width: 100%; margin-top: 0.5rem; }
  th, td { text-align: left; padding: 0.3rem 0.7rem; border-bottom: 1px solid rgba(127,127,127,0.25); font-size: 0.9rem; }
  .row { display: flex; gap: 1.5rem; flex-wrap: wrap; }
  .col { flex: 1 1 320px; min-width: 280px; }
  .muted { opacity: 0.65; font-size: 0.85rem; }
  .status-ok { color: #16a34a; }
  .status-err { color: #dc2626; }
</style>
</head>
<body>
<h1>reflex</h1>
<p class="muted">Local test page for <code>POST /decide</code>. Nothing here leaves this machine.</p>

<div class="row">
  <div class="col">
    <h3>Schema</h3>
    <textarea id="schema" spellcheck="false">${JSON.stringify(SAMPLE_SCHEMA, null, 2)}</textarea>
  </div>
  <div class="col">
    <h3>State</h3>
    <textarea id="state" spellcheck="false">${SAMPLE_STATE}</textarea>
    <p class="muted">Plain text or JSON.</p>
  </div>
</div>

<h3>Request body <span class="muted">(exactly what gets POSTed to /decide)</span></h3>
<pre id="requestPreview"></pre>

<p><button id="sendBtn">Send</button> <span id="statusLine" class="muted"></span></p>

<h3>Response</h3>
<div id="resultTable"></div>
<pre id="rawResponse"></pre>

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

  function renderTable(json) {
    if (!json.results) { tableEl.innerHTML = ''; return; }
    const rows = json.results.map(function (r) {
      const conf = r.confidence === null ? '-' : r.confidence.toFixed(3);
      return '<tr><td>' + escapeHtml(r.name) + '</td><td>' + escapeHtml(r.answer) + '</td><td>' +
        conf + '</td><td>' + escapeHtml(r.decidedBy) + '</td><td>' + r.latencyMs + 'ms</td></tr>';
    }).join('');
    tableEl.innerHTML =
      '<table><thead><tr><th>Question</th><th>Answer</th><th>Confidence</th><th>By</th><th>Latency</th></tr></thead><tbody>' +
      rows + '</tbody></table>' +
      '<p class="muted">Total ' + json.totalLatencyMs + 'ms, escalation rate ' +
      Math.round(json.escalationRate * 100) + '%</p>';
  }

  sendBtn.addEventListener('click', function () {
    const result = buildBody();
    if (result.error) {
      statusEl.textContent = result.error;
      statusEl.className = 'status-err';
      return;
    }
    statusEl.textContent = 'Sending...';
    statusEl.className = 'muted';
    tableEl.innerHTML = '';
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
          statusEl.textContent = 'HTTP ' + res.status + ' (' + elapsed + 'ms)';
          statusEl.className = 'status-err';
          return;
        }
        statusEl.textContent = 'OK (' + elapsed + 'ms round-trip)';
        statusEl.className = 'status-ok';
        renderTable(json);
      });
    }).catch(function (e) {
      statusEl.textContent = 'Request failed: ' + e.message;
      statusEl.className = 'status-err';
    });
  });
})();
</script>
</body>
</html>
`;
