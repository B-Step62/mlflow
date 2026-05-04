"""Standalone UI for the MLflow Agent Playground demo cockpit."""

PLAYGROUND_HTML = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MLflow Agent Playground</title>
  <style>
    :root {
      --bg: #f6f0e6;
      --panel: rgba(255, 251, 245, 0.92);
      --panel-strong: rgba(255, 248, 240, 0.98);
      --ink: #1e1a16;
      --muted: #6d6254;
      --line: rgba(30, 26, 22, 0.14);
      --accent: #b7472a;
      --accent-soft: rgba(183, 71, 42, 0.14);
      --tool: #18453b;
      --tool-soft: rgba(24, 69, 59, 0.10);
      --shadow: 0 18px 50px rgba(69, 45, 20, 0.10);
      --radius: 22px;
      --radius-sm: 14px;
      --mono: "SFMono-Regular", "IBM Plex Mono", "Menlo", monospace;
      --serif: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", "Georgia", serif;
      --sans: "Avenir Next", "Segoe UI", sans-serif;
    }

    * { box-sizing: border-box; }

    html, body {
      margin: 0;
      min-height: 100%;
      background:
        radial-gradient(circle at top left, rgba(183, 71, 42, 0.10), transparent 28%),
        radial-gradient(circle at bottom right, rgba(24, 69, 59, 0.10), transparent 32%),
        linear-gradient(135deg, #fbf7f1 0%, var(--bg) 55%, #efe4d4 100%);
      color: var(--ink);
      font-family: var(--sans);
    }

    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background-image:
        linear-gradient(rgba(30, 26, 22, 0.025) 1px, transparent 1px),
        linear-gradient(90deg, rgba(30, 26, 22, 0.025) 1px, transparent 1px);
      background-size: 26px 26px;
      mask-image: radial-gradient(circle at center, black, transparent 86%);
    }

    a {
      color: inherit;
    }

    button, input, textarea {
      font: inherit;
    }

    .app-shell {
      min-height: 100vh;
      padding: 24px;
      display: grid;
      gap: 18px;
    }

    .masthead {
      display: grid;
      grid-template-columns: minmax(0, 1.4fr) minmax(320px, 0.9fr);
      gap: 18px;
      align-items: stretch;
    }

    .hero,
    .control-panel,
    .chat-panel,
    .trace-panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      backdrop-filter: blur(16px);
    }

    .hero {
      padding: 24px 26px 22px;
      position: relative;
      overflow: hidden;
    }

    .hero::after {
      content: "DEMO";
      position: absolute;
      top: 14px;
      right: -8px;
      font: 700 12px/1 var(--mono);
      letter-spacing: 0.22em;
      color: rgba(30, 26, 22, 0.24);
      transform: rotate(90deg);
      transform-origin: center;
    }

    .eyebrow {
      font: 600 12px/1.3 var(--mono);
      letter-spacing: 0.22em;
      color: var(--accent);
      text-transform: uppercase;
      margin-bottom: 16px;
    }

    h1 {
      margin: 0 0 12px;
      font-family: var(--serif);
      font-weight: 600;
      font-size: clamp(2rem, 3.3vw, 3.6rem);
      line-height: 0.95;
      letter-spacing: -0.04em;
      max-width: 12ch;
    }

    .hero-copy {
      max-width: 60ch;
      color: var(--muted);
      font-size: 15px;
      line-height: 1.6;
      margin-bottom: 18px;
    }

    .hero-stats {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 34px;
      padding: 8px 12px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.42);
      color: var(--muted);
      font: 600 12px/1.2 var(--mono);
      letter-spacing: 0.02em;
    }

    .chip strong {
      color: var(--ink);
      font-weight: 700;
    }

    .control-panel {
      padding: 20px;
      display: grid;
      gap: 14px;
      align-content: start;
    }

    .panel-title {
      font: 700 13px/1.1 var(--mono);
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--ink);
      margin: 0;
    }

    .field-label,
    .section-label {
      display: block;
      margin-bottom: 8px;
      font: 700 11px/1.2 var(--mono);
      letter-spacing: 0.16em;
      color: var(--muted);
      text-transform: uppercase;
    }

    .field input {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      padding: 12px 14px;
      background: rgba(255, 255, 255, 0.72);
      color: var(--ink);
      font: 500 14px/1.4 var(--mono);
    }

    .field input:focus,
    textarea:focus {
      outline: 2px solid rgba(183, 71, 42, 0.22);
      outline-offset: 1px;
      border-color: rgba(183, 71, 42, 0.32);
    }

    .status-block {
      display: grid;
      gap: 10px;
      padding: 14px;
      border: 1px dashed rgba(30, 26, 22, 0.18);
      border-radius: var(--radius-sm);
      background: rgba(255, 255, 255, 0.42);
    }

    .status-line {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      font-size: 13px;
      color: var(--muted);
    }

    .status-line span:last-child {
      color: var(--ink);
      font-family: var(--mono);
      text-align: right;
    }

    .main-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.4fr) minmax(340px, 0.9fr);
      gap: 18px;
      min-height: calc(100vh - 180px);
    }

    .chat-panel,
    .trace-panel {
      min-height: 0;
      display: flex;
      flex-direction: column;
    }

    .chat-panel {
      overflow: hidden;
    }

    .chat-header,
    .trace-header {
      padding: 18px 20px 14px;
      border-bottom: 1px solid var(--line);
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 12px;
    }

    .header-copy {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
      max-width: 52ch;
    }

    .header-stack {
      display: grid;
      gap: 8px;
    }

    .message-stream {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 20px;
      display: grid;
      gap: 14px;
      align-content: start;
    }

    .empty-state {
      border: 1px dashed rgba(30, 26, 22, 0.16);
      border-radius: calc(var(--radius) - 6px);
      padding: 22px;
      background: rgba(255, 255, 255, 0.35);
      color: var(--muted);
      line-height: 1.7;
    }

    .message-card {
      border: 1px solid var(--line);
      border-radius: calc(var(--radius) - 6px);
      padding: 16px;
      background: var(--panel-strong);
      position: relative;
      overflow: hidden;
    }

    .message-card.user {
      border-color: rgba(183, 71, 42, 0.24);
      background: linear-gradient(180deg, rgba(183, 71, 42, 0.10), rgba(255, 251, 245, 0.95));
    }

    .message-card.assistant::before {
      content: "";
      position: absolute;
      inset: 0 auto 0 0;
      width: 4px;
      background: linear-gradient(180deg, var(--tool), var(--accent));
      opacity: 0.9;
    }

    .message-meta {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      margin-bottom: 10px;
      color: var(--muted);
      font: 700 11px/1.2 var(--mono);
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }

    .message-role {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .message-role::before {
      content: "";
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: var(--accent);
    }

    .message-card.assistant .message-role::before {
      background: var(--tool);
    }

    .message-content {
      white-space: pre-wrap;
      font-size: 15px;
      line-height: 1.7;
    }

    .message-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 14px;
    }

    .link-button,
    .ghost-button,
    .primary-button {
      appearance: none;
      border-radius: 999px;
      border: 1px solid var(--line);
      padding: 9px 13px;
      cursor: pointer;
      transition: transform 120ms ease, background 120ms ease, border-color 120ms ease;
      font: 700 12px/1.1 var(--mono);
      letter-spacing: 0.04em;
    }

    .link-button:hover,
    .ghost-button:hover,
    .primary-button:hover {
      transform: translateY(-1px);
    }

    .link-button {
      background: rgba(255, 255, 255, 0.75);
      color: var(--ink);
    }

    .ghost-button {
      background: rgba(255, 255, 255, 0.68);
      color: var(--muted);
    }

    .primary-button {
      border-color: rgba(183, 71, 42, 0.32);
      background: var(--accent);
      color: #fff8f2;
    }

    .primary-button:disabled,
    .ghost-button:disabled {
      cursor: not-allowed;
      opacity: 0.55;
      transform: none;
    }

    .tool-stack {
      display: grid;
      gap: 10px;
      margin-top: 14px;
    }

    details.tool-block {
      border: 1px solid rgba(24, 69, 59, 0.16);
      background: var(--tool-soft);
      border-radius: 16px;
      padding: 12px 14px;
    }

    details.tool-block summary {
      cursor: pointer;
      list-style: none;
      font: 700 12px/1.2 var(--mono);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--tool);
      display: flex;
      justify-content: space-between;
      gap: 12px;
    }

    details.tool-block summary::-webkit-details-marker {
      display: none;
    }

    .tool-payloads {
      display: grid;
      gap: 10px;
      margin-top: 12px;
    }

    .payload-label {
      font: 700 10px/1.2 var(--mono);
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 6px;
    }

    pre {
      margin: 0;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      border-radius: 12px;
      border: 1px solid rgba(30, 26, 22, 0.10);
      background: rgba(255, 255, 255, 0.72);
      padding: 12px;
      font: 12px/1.6 var(--mono);
      color: #2b241d;
    }

    .composer {
      padding: 18px 20px 20px;
      border-top: 1px solid var(--line);
      display: grid;
      gap: 12px;
      background: rgba(255, 252, 248, 0.88);
    }

    textarea {
      width: 100%;
      min-height: 120px;
      resize: vertical;
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 16px;
      background: rgba(255, 255, 255, 0.78);
      color: var(--ink);
      font-size: 15px;
      line-height: 1.6;
    }

    .composer-footer {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
    }

    .composer-hint {
      color: var(--muted);
      font: 600 12px/1.5 var(--mono);
      letter-spacing: 0.02em;
    }

    .trace-panel {
      overflow: hidden;
    }

    .trace-body {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 18px 20px 22px;
      display: grid;
      gap: 14px;
      align-content: start;
    }

    .trace-summary {
      display: grid;
      gap: 10px;
      border: 1px solid var(--line);
      border-radius: calc(var(--radius) - 6px);
      padding: 16px;
      background: rgba(255, 255, 255, 0.54);
    }

    .trace-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .trace-kv {
      padding: 10px 12px;
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.72);
      border: 1px solid rgba(30, 26, 22, 0.08);
    }

    .trace-kv strong,
    .trace-kv span {
      display: block;
    }

    .trace-kv strong {
      color: var(--muted);
      font: 700 10px/1.2 var(--mono);
      letter-spacing: 0.14em;
      text-transform: uppercase;
      margin-bottom: 6px;
    }

    .trace-kv span {
      color: var(--ink);
      font-size: 13px;
      line-height: 1.5;
      word-break: break-word;
    }

    .span-list {
      display: grid;
      gap: 10px;
    }

    .span-card {
      border: 1px solid var(--line);
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.74);
      padding: 14px;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.55);
    }

    .span-header {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 10px;
    }

    .span-name {
      font-family: var(--serif);
      font-size: 22px;
      line-height: 1;
      letter-spacing: -0.03em;
      margin: 0;
    }

    .span-badges {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .span-badge {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 6px 10px;
      font: 700 10px/1.2 var(--mono);
      letter-spacing: 0.14em;
      text-transform: uppercase;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.8);
      color: var(--muted);
    }

    .span-children {
      margin-top: 10px;
      padding-left: 16px;
      border-left: 1px dashed rgba(30, 26, 22, 0.16);
      display: grid;
      gap: 10px;
    }

    .status-banner {
      position: fixed;
      right: 20px;
      bottom: 20px;
      max-width: min(420px, calc(100vw - 40px));
      padding: 14px 16px;
      border-radius: 18px;
      background: rgba(30, 26, 22, 0.92);
      color: #fff7ee;
      box-shadow: 0 12px 38px rgba(0, 0, 0, 0.20);
      font-size: 13px;
      line-height: 1.5;
      opacity: 0;
      transform: translateY(18px);
      pointer-events: none;
      transition: opacity 160ms ease, transform 160ms ease;
    }

    .status-banner.visible {
      opacity: 1;
      transform: translateY(0);
    }

    .caret {
      display: inline-block;
      width: 9px;
      height: 1.1em;
      vertical-align: -0.2em;
      margin-left: 2px;
      background: linear-gradient(180deg, transparent 0 12%, rgba(30, 26, 22, 0.88) 12% 88%, transparent 88%);
      animation: blink 1s step-end infinite;
    }

    @keyframes blink {
      50% { opacity: 0; }
    }

    @media (max-width: 1080px) {
      .masthead,
      .main-grid {
        grid-template-columns: 1fr;
      }

      .main-grid {
        min-height: auto;
      }
    }

    @media (max-width: 700px) {
      .app-shell {
        padding: 14px;
      }

      .hero,
      .control-panel,
      .chat-panel,
      .trace-panel {
        border-radius: 20px;
      }

      h1 {
        max-width: none;
      }

      .trace-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="app-shell">
    <section class="masthead">
      <div class="hero">
        <div class="eyebrow">MLflow Agent Playground</div>
        <h1>Chat. Inspect. Trace.</h1>
        <div class="hero-copy">
          Fast-demo cockpit for an <code>@invoke</code>-decorated agent. The thread on the left
          stays intentionally thin; the trace rail on the right carries the real receipts.
        </div>
        <div class="hero-stats">
          <div class="chip"><strong id="mode-chip">auto</strong> protocol</div>
          <div class="chip"><strong id="trace-chip">0</strong> traces captured</div>
          <div class="chip"><strong>demo</strong> synthetic stream fallback</div>
        </div>
      </div>

      <aside class="control-panel">
        <div class="header-stack">
          <h2 class="panel-title">Control Surface</h2>
          <div class="header-copy">
            One override matters for the demo: where the agent server is listening.
          </div>
        </div>

        <label class="field">
          <span class="field-label">Agent Base URL</span>
          <input id="agent-url" type="text" spellcheck="false" value="http://127.0.0.1:8000" />
        </label>

        <div class="status-block">
          <div class="status-line"><span>Tracking URI</span><span id="tracking-uri">loading…</span></div>
          <div class="status-line"><span>Experiment</span><span id="experiment-name">loading…</span></div>
          <div class="status-line"><span>Server status</span><span id="server-status">warming up</span></div>
          <div class="status-line"><span>Last trace</span><span id="last-trace">none yet</span></div>
        </div>

        <button id="ping-agent" class="ghost-button" type="button">Ping Agent</button>
      </aside>
    </section>

    <section class="main-grid">
      <section class="chat-panel">
        <div class="chat-header">
          <div class="header-stack">
            <h2 class="panel-title">Live Thread</h2>
            <div class="header-copy">
              Messages are preserved client-side. If the upstream agent only supports plain
              <code>invoke</code>, the playground simulates streaming so the demo still moves.
            </div>
          </div>
          <button id="clear-thread" class="link-button" type="button">Clear Thread</button>
        </div>

        <div id="message-stream" class="message-stream">
          <div class="empty-state">
            Send a turn to start the session. The right rail will automatically lock onto the latest
            returned trace and unfold the span stack.
          </div>
        </div>

        <form id="composer" class="composer">
          <div>
            <label class="section-label" for="composer-input">Message</label>
            <textarea
              id="composer-input"
              placeholder="Ask the agent something concrete. The faster demo move is to hit a tool path."
            ></textarea>
          </div>
          <div class="composer-footer">
            <div class="composer-hint">Enter to send. Shift+Enter for a new line.</div>
            <button id="send-button" class="primary-button" type="submit">Send Turn</button>
          </div>
        </form>
      </section>

      <aside class="trace-panel">
        <div class="trace-header">
          <div class="header-stack">
            <h2 class="panel-title">Live Trace Panel</h2>
            <div class="header-copy">
              Tool blocks inline in the thread are derived from the trace. The full span tree lands here.
            </div>
          </div>
        </div>

        <div id="trace-body" class="trace-body">
          <div class="empty-state">
            No trace selected yet. Once a turn completes, the latest trace opens here automatically.
          </div>
        </div>
      </aside>
    </section>
  </div>

  <div id="status-banner" class="status-banner" role="status" aria-live="polite"></div>

  <script>
    const state = {
      messages: [],
      pendingText: "",
      traceCount: 0,
      traceCache: new Map(),
      activeTraceId: null,
      agentProtocol: "auto",
      config: null,
      busy: false,
    };

    const elements = {
      modeChip: document.getElementById("mode-chip"),
      traceChip: document.getElementById("trace-chip"),
      trackingUri: document.getElementById("tracking-uri"),
      experimentName: document.getElementById("experiment-name"),
      serverStatus: document.getElementById("server-status"),
      lastTrace: document.getElementById("last-trace"),
      agentUrl: document.getElementById("agent-url"),
      pingAgent: document.getElementById("ping-agent"),
      clearThread: document.getElementById("clear-thread"),
      messageStream: document.getElementById("message-stream"),
      composer: document.getElementById("composer"),
      composerInput: document.getElementById("composer-input"),
      sendButton: document.getElementById("send-button"),
      traceBody: document.getElementById("trace-body"),
      banner: document.getElementById("status-banner"),
    };

    function showBanner(message) {
      elements.banner.textContent = message;
      elements.banner.classList.add("visible");
      window.clearTimeout(showBanner._timer);
      showBanner._timer = window.setTimeout(() => {
        elements.banner.classList.remove("visible");
      }, 2600);
    }

    function escapeHtml(value) {
      return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
    }

    function formatTime(value) {
      if (!value) {
        return "—";
      }
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return value;
      }
      return date.toLocaleString();
    }

    function formatJson(value) {
      if (value === null || value === undefined || value === "") {
        return "—";
      }
      if (typeof value === "string") {
        try {
          return JSON.stringify(JSON.parse(value), null, 2);
        } catch {
          return value;
        }
      }
      return JSON.stringify(value, null, 2);
    }

    function setBusy(isBusy) {
      state.busy = isBusy;
      elements.sendButton.disabled = isBusy;
      elements.pingAgent.disabled = isBusy;
      elements.agentUrl.disabled = isBusy;
      elements.serverStatus.textContent = isBusy ? "waiting on agent" : "ready";
    }

    function makeMessageCard(message) {
      const card = document.createElement("article");
      card.className = `message-card ${message.role}`;

      const meta = document.createElement("div");
      meta.className = "message-meta";

      const role = document.createElement("div");
      role.className = "message-role";
      role.textContent = message.role === "assistant" ? "Assistant" : "User";

      const stamp = document.createElement("div");
      stamp.textContent = message.trace_id ? message.trace_id : "turn " + String(state.messages.length + 1).padStart(2, "0");

      meta.append(role, stamp);
      card.appendChild(meta);

      const content = document.createElement("div");
      content.className = "message-content";
      content.textContent = message.content;
      card.appendChild(content);

      if (message.pending) {
        const caret = document.createElement("span");
        caret.className = "caret";
        content.appendChild(caret);
      }

      if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
        const stack = document.createElement("div");
        stack.className = "tool-stack";

        message.tool_calls.forEach((tool) => {
          const details = document.createElement("details");
          details.className = "tool-block";

          const summary = document.createElement("summary");
          summary.innerHTML = `<span>${escapeHtml(tool.name || "tool")}</span><span>${escapeHtml(tool.duration_ms || "—")} ms</span>`;
          details.appendChild(summary);

          const payloads = document.createElement("div");
          payloads.className = "tool-payloads";
          payloads.innerHTML = `
            <div>
              <div class="payload-label">Inputs</div>
              <pre>${escapeHtml(formatJson(tool.inputs))}</pre>
            </div>
            <div>
              <div class="payload-label">Outputs</div>
              <pre>${escapeHtml(formatJson(tool.outputs))}</pre>
            </div>
          `;
          details.appendChild(payloads);
          stack.appendChild(details);
        });

        card.appendChild(stack);
      }

      if (message.role === "assistant" && message.trace_id) {
        const actions = document.createElement("div");
        actions.className = "message-actions";

        const traceButton = document.createElement("button");
        traceButton.type = "button";
        traceButton.className = "link-button";
        traceButton.textContent = "Open Trace";
        traceButton.addEventListener("click", () => {
          loadTrace(message.trace_id);
        });
        actions.appendChild(traceButton);

        card.appendChild(actions);
      }

      return card;
    }

    function renderMessages() {
      elements.messageStream.innerHTML = "";

      if (!state.messages.length) {
        elements.messageStream.innerHTML = `
          <div class="empty-state">
            Send a turn to start the session. The right rail will automatically lock onto the latest
            returned trace and unfold the span stack.
          </div>
        `;
        return;
      }

      state.messages.forEach((message) => {
        elements.messageStream.appendChild(makeMessageCard(message));
      });

      elements.messageStream.scrollTop = elements.messageStream.scrollHeight;
    }

    function renderTrace(tracePayload) {
      if (!tracePayload) {
        elements.traceBody.innerHTML = `
          <div class="empty-state">
            No trace selected yet. Once a turn completes, the latest trace opens here automatically.
          </div>
        `;
        return;
      }

      const summary = tracePayload.summary || {};
      const spans = tracePayload.trace?.data?.spans || [];
      const spanCards = renderSpanTree(spans, null, 0);

      elements.traceBody.innerHTML = "";

      const summaryBlock = document.createElement("section");
      summaryBlock.className = "trace-summary";
      summaryBlock.innerHTML = `
        <div class="panel-title">Trace ${escapeHtml(summary.trace_id || "—")}</div>
        <div class="trace-grid">
          <div class="trace-kv"><strong>Status</strong><span>${escapeHtml(summary.state || "—")}</span></div>
          <div class="trace-kv"><strong>Duration</strong><span>${escapeHtml(summary.execution_duration_ms || "—")} ms</span></div>
          <div class="trace-kv"><strong>Request Time</strong><span>${escapeHtml(formatTime(summary.request_time))}</span></div>
          <div class="trace-kv"><strong>Span Count</strong><span>${escapeHtml(String(summary.span_count || 0))}</span></div>
        </div>
      `;
      elements.traceBody.appendChild(summaryBlock);

      const rawButton = document.createElement("button");
      rawButton.type = "button";
      rawButton.className = "ghost-button";
      rawButton.textContent = "Copy Trace JSON";
      rawButton.addEventListener("click", async () => {
        await navigator.clipboard.writeText(JSON.stringify(tracePayload.trace, null, 2));
        showBanner("Trace JSON copied.");
      });
      elements.traceBody.appendChild(rawButton);

      const spanList = document.createElement("div");
      spanList.className = "span-list";
      if (spanCards.length) {
        spanCards.forEach((node) => spanList.appendChild(node));
      } else {
        spanList.innerHTML = '<div class="empty-state">Trace loaded, but no spans were available.</div>';
      }
      elements.traceBody.appendChild(spanList);
    }

    function renderSpanTree(spans, parentId, depth) {
      return spans
        .filter((span) => (span.parent_span_id || null) === parentId)
        .sort((a, b) => (a.start_time_unix_nano || 0) - (b.start_time_unix_nano || 0))
        .map((span) => {
          const node = document.createElement("section");
          node.className = "span-card";
          if (depth) {
            node.style.marginLeft = `${Math.min(depth * 10, 28)}px`;
          }

          const attrs = span.attributes || {};
          const spanType = attrs["mlflow.spanType"] || "UNKNOWN";
          const durationMs = span.end_time_unix_nano && span.start_time_unix_nano
            ? ((span.end_time_unix_nano - span.start_time_unix_nano) / 1000000).toFixed(1)
            : "—";

          const header = document.createElement("div");
          header.className = "span-header";
          header.innerHTML = `
            <div>
              <h3 class="span-name">${escapeHtml(span.name || "span")}</h3>
            </div>
            <div class="span-badges">
              <span class="span-badge">${escapeHtml(String(spanType).replaceAll('"', ""))}</span>
              <span class="span-badge">${escapeHtml(durationMs)} ms</span>
            </div>
          `;
          node.appendChild(header);

          const payloads = document.createElement("div");
          payloads.className = "tool-payloads";
          payloads.innerHTML = `
            <div>
              <div class="payload-label">Inputs</div>
              <pre>${escapeHtml(formatJson(attrs["mlflow.spanInputs"]))}</pre>
            </div>
            <div>
              <div class="payload-label">Outputs</div>
              <pre>${escapeHtml(formatJson(attrs["mlflow.spanOutputs"]))}</pre>
            </div>
          `;
          node.appendChild(payloads);

          const children = renderSpanTree(spans, span.span_id || null, depth + 1);
          if (children.length) {
            const childWrap = document.createElement("div");
            childWrap.className = "span-children";
            children.forEach((child) => childWrap.appendChild(child));
            node.appendChild(childWrap);
          }

          return node;
        });
    }

    async function loadConfig() {
      const response = await fetch("/playground/api/config");
      if (!response.ok) {
        throw new Error("Failed to load playground config.");
      }

      state.config = await response.json();
      elements.agentUrl.value = window.localStorage.getItem("mlflow-playground-agent-url") || state.config.agent_url;
      elements.trackingUri.textContent = state.config.tracking_uri || "not configured";
      elements.experimentName.textContent = state.config.experiment || "not configured";
      elements.serverStatus.textContent = "ready";
    }

    async function pingAgent() {
      const agentUrl = elements.agentUrl.value.trim();
      if (!agentUrl) {
        showBanner("Agent URL is required.");
        return;
      }

      setBusy(true);
      try {
        const response = await fetch("/playground/api/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent_url: agentUrl }),
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.detail || "Could not reach agent.");
        }

        state.agentProtocol = payload.protocol || "messages";
        elements.modeChip.textContent = state.agentProtocol;
        elements.serverStatus.textContent = payload.connected ? "agent reachable" : "ready";
        window.localStorage.setItem("mlflow-playground-agent-url", agentUrl);
        showBanner("Agent connection verified.");
      } catch (error) {
        elements.serverStatus.textContent = "agent unreachable";
        showBanner(error.message || "Could not reach the agent.");
      } finally {
        setBusy(false);
      }
    }

    async function loadTrace(traceId) {
      if (!traceId) {
        return;
      }
      elements.lastTrace.textContent = traceId;
      state.activeTraceId = traceId;

      if (state.traceCache.has(traceId)) {
        renderTrace(state.traceCache.get(traceId));
        return;
      }

      try {
        const response = await fetch(`/playground/api/traces/${encodeURIComponent(traceId)}`);
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.detail || "Could not load trace.");
        }
        state.traceCache.set(traceId, payload);
        renderTrace(payload);
      } catch (error) {
        renderTrace(null);
        showBanner(error.message || "Could not load trace.");
      }
    }

    async function sendTurn(event) {
      event.preventDefault();
      if (state.busy) {
        return;
      }

      const content = elements.composerInput.value.trim();
      if (!content) {
        return;
      }

      const agentUrl = elements.agentUrl.value.trim();
      if (!agentUrl) {
        showBanner("Agent URL is required.");
        return;
      }

      window.localStorage.setItem("mlflow-playground-agent-url", agentUrl);
      elements.composerInput.value = "";

      state.messages.push({ role: "user", content });
      state.messages.push({ role: "assistant", content: "", pending: true, tool_calls: [] });
      renderMessages();
      setBusy(true);

      try {
        const response = await fetch("/playground/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: state.messages.filter((message) => !message.pending).map(({ role, content }) => ({ role, content })),
            agent_url: agentUrl,
          }),
        });

        if (!response.ok || !response.body) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.detail || "Chat request failed.");
        }

        const decoder = new TextDecoder();
        const reader = response.body.getReader();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\\n\\n");
          buffer = events.pop() || "";

          for (const rawEvent of events) {
            const line = rawEvent
              .split("\\n")
              .find((candidate) => candidate.startsWith("data: "));
            if (!line) {
              continue;
            }

            const payload = JSON.parse(line.slice(6));
            if (payload.type === "assistant_delta") {
              state.messages[state.messages.length - 1].content += payload.delta;
              renderMessages();
            } else if (payload.type === "assistant_final") {
              state.messages[state.messages.length - 1] = {
                role: "assistant",
                content: payload.message.content,
                trace_id: payload.trace_id,
                tool_calls: payload.tool_calls || [],
              };
              state.traceCount += payload.trace_id ? 1 : 0;
              elements.traceChip.textContent = String(state.traceCount);
              elements.modeChip.textContent = payload.protocol || state.agentProtocol;
              state.agentProtocol = payload.protocol || state.agentProtocol;
              renderMessages();
              if (payload.trace_id) {
                await loadTrace(payload.trace_id);
              }
            } else if (payload.type === "error") {
              throw new Error(payload.error || "Agent request failed.");
            }
          }
        }
      } catch (error) {
        state.messages[state.messages.length - 1] = {
          role: "assistant",
          content: `Error: ${error.message || "unknown failure"}`,
          tool_calls: [],
        };
        renderMessages();
        showBanner(error.message || "Agent request failed.");
      } finally {
        setBusy(false);
      }
    }

    elements.composer.addEventListener("submit", sendTurn);
    elements.pingAgent.addEventListener("click", pingAgent);
    elements.clearThread.addEventListener("click", () => {
      state.messages = [];
      renderMessages();
      renderTrace(null);
      elements.lastTrace.textContent = "none yet";
      state.traceCache.clear();
      state.activeTraceId = null;
      showBanner("Thread cleared.");
    });
    elements.composerInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        elements.composer.requestSubmit();
      }
    });

    loadConfig().catch((error) => {
      elements.serverStatus.textContent = "config error";
      showBanner(error.message || "Failed to load playground config.");
    });
  </script>
</body>
</html>
"""
