/* report-qa-bridge ask widget v1 — inlined into reports by `rqb report add` / `rqb inject`. */
(() => {
  if (window.__rqbLoaded) return; window.__rqbLoaded = true;
  const cfgEl = document.getElementById("rqb-config");
  const CFG = cfgEl ? JSON.parse(cfgEl.textContent) : {};
  const LANG = CFG.lang || ((document.documentElement.lang || "").toLowerCase().startsWith("zh") ? "zh" : "en");
  const T = {
    zh: {
      ask: "问 Claude", fab: "💬 问 Claude", newTopic: "新话题", settings: "连接设置", close: "关闭",
      cfgIntro: "连接信息由报告作者提供，填一次即可，本机所有报告通用。", url: "服务地址", token: "个人口令", tokenPh: "48 位口令（作者单独发给你）", save: "保存并测试",
      testing: "测试中…", okConn: "连接成功 ✓", badConn: "连接失败，请检查地址和口令",
      empty: "选中报告里的文字后点\"问 Claude\"，选中内容会自动带上；也可以直接输入问题。",
      topicReset: "已开始新话题。", placeholder: "输入你的问题，Enter 发送，Shift + Enter 换行", send: "发送",
      readonly: "只读：Claude 不会修改代码或数据", you: "你", claude: "Claude", error: "出错了",
      thinking: s => `Claude 正在查资料… ${s} 秒`, timeout: "等待超时，请稍后再试。", offline: "连不上服务（作者电脑可能没开着）。",
      stNone: "有疑问？点右下角\"问 Claude\"，在 ⚙ 里填好连接信息即可提问。", stBadToken: "口令不对，请在 ⚙ 里重新填写。",
      stOffline: "暂时连不上问答服务，稍后再试，或联系报告作者。", stNoReport: "这份报告还没在问答服务上登记，请联系作者。",
      stDenied: "你不在这份报告的提问名单里，请联系作者。", stOk: u => `已连接（${u}）。选中任意文字即可提问。`,
      dropQuote: "不带这段内容",
      sessBase: "基于会话", sessThread: "当前会话", sessNone: "无会话上下文", copied: "已复制",
      copyHint: "点击复制；作者可用 claude --resume <id> 打开",
    },
    en: {
      ask: "Ask Claude", fab: "💬 Ask Claude", newTopic: "New topic", settings: "Connection", close: "Close",
      cfgIntro: "Get these from the report author. You only need to enter them once for all reports.", url: "Server URL", token: "Personal token", tokenPh: "48-character token from the author", save: "Save & test",
      testing: "Testing…", okConn: "Connected ✓", badConn: "Failed — check the URL and token",
      empty: "Select any text in the report and click \"Ask Claude\" — the selection is attached automatically. Or just type a question.",
      topicReset: "Started a new topic.", placeholder: "Type your question — Enter to send, Shift + Enter for a new line", send: "Send",
      readonly: "Read-only: Claude cannot change code or data", you: "You", claude: "Claude", error: "Error",
      thinking: s => `Claude is looking into it… ${s}s`, timeout: "Timed out, please try again later.", offline: "Cannot reach the server (the author's machine may be off).",
      stNone: "Questions? Click \"Ask Claude\" (bottom right) and fill in the connection under ⚙.", stBadToken: "Wrong token — update it under ⚙.",
      stOffline: "Q&A server unreachable right now. Try later or contact the author.", stNoReport: "This report is not registered on the Q&A server yet — contact the author.",
      stDenied: "You are not on this report's reader list — contact the author.", stOk: u => `Connected as ${u}. Select any text to ask.`,
      dropQuote: "Don't attach this",
      sessBase: "Based on session", sessThread: "Session", sessNone: "no session context", copied: "Copied",
      copyHint: "Click to copy; the author can open it with claude --resume <id>",
    },
  }[LANG];

  const LS = { url: "rqb.url", token: "rqb.token" };
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get("rqb-url")) localStorage.setItem(LS.url, hash.get("rqb-url"));
  if (hash.get("rqb-token")) localStorage.setItem(LS.token, hash.get("rqb-token"));
  if (hash.get("rqb-url") || hash.get("rqb-token")) window.addEventListener("load", () => setTimeout(() => history.replaceState(null, "", location.pathname + location.search), 0));
  const conn = () => ({ url: (localStorage.getItem(LS.url) || "").replace(/\/+$/, ""), token: localStorage.getItem(LS.token) || "" });

  // ---------- styles ----------
  const css = `
  #rqb-root{--b:#0969da;--bg:#fff;--bg2:#f6f8fa;--fg:#1f2328;--mu:#656d76;--bd:#d0d7de;--qb:#ddf4ff;--er:#cf222e;--cd:#eff1f3;font:14px/1.6 -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:var(--fg)}
  @media (prefers-color-scheme:dark){#rqb-root{--b:#4493f8;--bg:#161b22;--bg2:#0d1117;--fg:#e6edf3;--mu:#8d96a0;--bd:#30363d;--qb:#12263f;--er:#ff7b72;--cd:#1f2630}}
  #rqb-root *{box-sizing:border-box}
  #rqb-pop{position:absolute;z-index:2147483600;display:none;background:var(--b);color:#fff;border:0;border-radius:8px;padding:5px 12px;font:inherit;font-size:13px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.18)}
  #rqb-fab{position:fixed;right:24px;bottom:24px;z-index:2147483600;background:var(--b);color:#fff;border:0;border-radius:999px;padding:10px 18px;font:inherit;font-weight:600;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.2)}
  #rqb-fab .rqb-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-left:8px;background:#bbb;vertical-align:middle}
  #rqb-fab .rqb-dot.ok{background:#3fb950}#rqb-fab .rqb-dot.bad{background:#ff7b72}
  #rqb-panel{position:fixed;top:0;right:0;bottom:0;width:min(520px,100vw);z-index:2147483601;background:var(--bg);border-left:1px solid var(--bd);box-shadow:-8px 0 30px rgba(0,0,0,.15);display:flex;flex-direction:column;transform:translateX(105%);transition:transform .2s ease}
  #rqb-panel.open{transform:none}
  .rqb-head{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--bd)}
  .rqb-head b{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .rqb-btn{border:1px solid var(--bd);background:var(--bg);color:var(--fg);border-radius:6px;padding:3px 10px;font:inherit;font-size:12px;cursor:pointer}
  .rqb-btn.pri{background:var(--b);border-color:var(--b);color:#fff}.rqb-btn:disabled{opacity:.5;cursor:default}
  .rqb-status{padding:6px 16px;font-size:12px;color:var(--mu);border-bottom:1px solid var(--bd);background:var(--bg2)}
  .rqb-sess{padding:4px 16px;font-size:11px;color:var(--mu);border-bottom:1px solid var(--bd);font-family:Consolas,"Cascadia Code",monospace;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.rqb-sess:hover{color:var(--fg)}.rqb-sess[hidden]{display:none}
  .rqb-cfg{display:none;padding:12px 16px;border-bottom:1px solid var(--bd);background:var(--bg2);font-size:13px}.rqb-cfg.open{display:block}
  .rqb-cfg label{display:block;margin:6px 0 2px;color:var(--mu);font-size:12px}
  .rqb-cfg input{width:100%;border:1px solid var(--bd);border-radius:6px;padding:6px 8px;font:inherit;background:var(--bg);color:var(--fg)}
  .rqb-body{flex:1;overflow-y:auto;padding:14px 16px}
  .rqb-empty{color:var(--mu);font-size:13px;white-space:pre-wrap}
  .rqb-msg{margin-bottom:14px}.rqb-who{font-size:12px;color:var(--mu);margin-bottom:3px}
  .rqb-q .rqb-bub{background:var(--qb);border-radius:8px;padding:8px 12px;white-space:pre-wrap}
  .rqb-a .rqb-bub{border:1px solid var(--bd);border-radius:8px;padding:8px 12px}
  .rqb-err .rqb-bub{border:1px solid var(--er);color:var(--er);border-radius:8px;padding:8px 12px}
  .rqb-thinking{color:var(--mu);font-size:13px}
  .rqb-quote{border-left:3px solid var(--b);padding:2px 10px;margin:0 0 6px;color:var(--mu);font-size:13px;white-space:pre-wrap;max-height:120px;overflow:auto}
  .rqb-bub table{border-collapse:collapse;font-size:12px;margin:6px 0}.rqb-bub th,.rqb-bub td{border:1px solid var(--bd);padding:4px 8px;text-align:left;vertical-align:top}
  .rqb-bub pre{background:var(--cd);padding:8px;border-radius:6px;overflow-x:auto;font-size:12px}
  .rqb-bub code{background:var(--cd);padding:1px 4px;border-radius:4px;font-size:12px;word-break:break-all}
  .rqb-bub p{margin:4px 0}.rqb-bub ul,.rqb-bub ol{margin:4px 0;padding-left:20px}.rqb-bub h2,.rqb-bub h3,.rqb-bub h4,.rqb-bub h5{font-size:14px;margin:8px 0 4px}
  .rqb-foot{border-top:1px solid var(--bd);padding:10px 16px 14px}
  .rqb-ctx{display:flex;gap:8px;align-items:flex-start;margin-bottom:6px}.rqb-ctx[hidden]{display:none}.rqb-ctx .rqb-quote{flex:1;margin:0}
  .rqb-foot textarea{width:100%;min-height:70px;resize:vertical;border:1px solid var(--bd);border-radius:8px;padding:8px 10px;font:inherit;background:var(--bg2);color:var(--fg)}
  .rqb-row{display:flex;justify-content:space-between;align-items:center;margin-top:6px;font-size:12px;color:var(--mu)}
  @media print{#rqb-root{display:none!important}}`;
  const style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);

  // ---------- DOM ----------
  const root = document.createElement("div"); root.id = "rqb-root";
  root.innerHTML = `
    <button id="rqb-pop" type="button">${T.ask}</button>
    <button id="rqb-fab" type="button">${T.fab}<span class="rqb-dot" id="rqb-dot"></span></button>
    <aside id="rqb-panel" aria-label="${T.ask}">
      <div class="rqb-head"><b id="rqb-title"></b>
        <button class="rqb-btn" id="rqb-new" type="button">${T.newTopic}</button>
        <button class="rqb-btn" id="rqb-gear" type="button" title="${T.settings}">⚙</button>
        <button class="rqb-btn" id="rqb-close" type="button" title="${T.close}">✕</button></div>
      <div class="rqb-sess" id="rqb-sess" hidden title="${T.copyHint}"></div>
      <div class="rqb-status" id="rqb-status"></div>
      <div class="rqb-cfg" id="rqb-cfg"><div>${T.cfgIntro}</div>
        <label for="rqb-url">${T.url}</label><input id="rqb-url" placeholder="http://192.168.x.x:8787" autocomplete="off">
        <label for="rqb-token">${T.token}</label><input id="rqb-token" type="text" spellcheck="false" autocomplete="off" placeholder="${T.tokenPh}">
        <div class="rqb-row"><span id="rqb-cfg-msg"></span><button class="rqb-btn pri" id="rqb-save" type="button">${T.save}</button></div></div>
      <div class="rqb-body" id="rqb-body"><div class="rqb-empty">${esc(T.empty)}</div></div>
      <div class="rqb-foot">
        <div class="rqb-ctx" id="rqb-ctx" hidden><div class="rqb-quote" id="rqb-ctx-q"></div><button class="rqb-btn" id="rqb-ctx-x" type="button" title="${T.dropQuote}">✕</button></div>
        <textarea id="rqb-input" placeholder="${T.placeholder}"></textarea>
        <div class="rqb-row"><span>${T.readonly}</span><button class="rqb-btn pri" id="rqb-send" type="button">${T.send}</button></div>
      </div>
    </aside>`;
  document.body.appendChild(root);
  const $ = id => document.getElementById(id);
  const panel = $("rqb-panel"), pop = $("rqb-pop"), body = $("rqb-body"), input = $("rqb-input"), sendBtn = $("rqb-send");
  $("rqb-title").textContent = `${T.ask} · ${CFG.title || CFG.reportId || ""}`;
  let ctx = { quote: "", ref: "" }, threadId = null, busy = false, baseSession = null, threadSession = null;
  function renderSession() {
    const el = $("rqb-sess");
    const id = threadSession || baseSession;
    el.hidden = false;
    el.dataset.id = id || "";
    el.textContent = id ? `${threadSession ? T.sessThread : T.sessBase}: ${id}` : `${T.sessBase}: ${T.sessNone}`;
  }
  $("rqb-sess").onclick = async () => {
    const id = $("rqb-sess").dataset.id; if (!id) return;
    try { await navigator.clipboard.writeText(id); } catch { const r = document.createRange(); r.selectNodeContents($("rqb-sess")); getSelection().removeAllRanges(); getSelection().addRange(r); }
    const old = $("rqb-sess").textContent; $("rqb-sess").textContent = `${T.copied} ✓  ${id}`; setTimeout(() => ($("rqb-sess").textContent = old), 1200);
  };

  function esc(s) { return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  function setStatus(state, text) { $("rqb-dot").className = "rqb-dot " + (state || ""); $("rqb-status").textContent = text; }
  async function health() {
    const { url, token } = conn();
    if (!url || !token) { setStatus("", T.stNone); return false; }
    try {
      const r = await fetch(`${url}/health?report=${encodeURIComponent(CFG.reportId || "")}`, { headers: { Authorization: "Bearer " + token } });
      if (r.status === 401) { setStatus("bad", T.stBadToken); return false; }
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      if (!j.report) { setStatus("bad", T.stNoReport); return false; }
      if (!j.report.allowed) { setStatus("bad", T.stDenied); return false; }
      baseSession = j.report.session || null; renderSession();
      setStatus("ok", T.stOk(j.user)); return true;
    } catch { setStatus("bad", T.stOffline); return false; }
  }

  // ---------- selection ----------
  function refFor(node) {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    if (!el) return "";
    const tagged = el.closest("[data-rqb-ref]");
    if (tagged) return tagged.getAttribute("data-rqb-ref");
    // fall back to the nearest preceding heading
    let cur = el;
    while (cur && cur !== document.body) {
      let sib = cur;
      while ((sib = sib.previousElementSibling)) {
        if (/^H[1-4]$/.test(sib.tagName)) return sib.textContent.trim().slice(0, 80);
        const h = sib.querySelector && sib.querySelector("h1,h2,h3,h4");
        if (h) return h.textContent.trim().slice(0, 80);
      }
      cur = cur.parentElement;
    }
    return "";
  }
  document.addEventListener("mouseup", e => {
    if (root.contains(e.target)) return;
    setTimeout(() => {
      const sel = window.getSelection(); const text = sel ? sel.toString().trim() : "";
      if (text.length < 2 || !sel.rangeCount) { pop.style.display = "none"; return; }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      pop.style.left = Math.min(window.scrollX + rect.right - 40, window.scrollX + document.documentElement.clientWidth - 130) + "px";
      pop.style.top = (window.scrollY + rect.bottom + 6) + "px";
      pop.style.display = "block";
      pop.dataset.quote = text.slice(0, 3000); pop.dataset.ref = refFor(sel.anchorNode);
    }, 0);
  });
  document.addEventListener("mousedown", e => { if (e.target !== pop) pop.style.display = "none"; });
  pop.addEventListener("click", () => { setCtx(pop.dataset.quote, pop.dataset.ref); pop.style.display = "none"; openPanel(); });

  function setCtx(quote, ref) {
    ctx = { quote: quote || "", ref: ref || "" };
    $("rqb-ctx").hidden = !ctx.quote;
    $("rqb-ctx-q").textContent = (ctx.ref ? `[${ctx.ref}] ` : "") + ctx.quote;
  }
  $("rqb-ctx-x").onclick = () => setCtx("", "");

  function openPanel() { panel.classList.add("open"); const { url, token } = conn(); if (!url || !token) toggleCfg(true); else input.focus(); }
  $("rqb-fab").onclick = openPanel;
  $("rqb-close").onclick = () => panel.classList.remove("open");
  $("rqb-new").onclick = () => { threadId = null; threadSession = null; renderSession(); body.innerHTML = `<div class="rqb-empty">${esc(T.topicReset)}</div>`; };

  function toggleCfg(open) {
    const el = $("rqb-cfg"); el.classList.toggle("open", open ?? !el.classList.contains("open"));
    $("rqb-url").value = conn().url; $("rqb-token").value = conn().token;
  }
  $("rqb-gear").onclick = () => toggleCfg();
  $("rqb-save").onclick = async () => {
    const tok = ($("rqb-token").value.trim().split(/\s+/).pop() || "").replace(/^["']|["']$/g, "");
    $("rqb-token").value = tok;
    localStorage.setItem(LS.url, $("rqb-url").value.trim()); localStorage.setItem(LS.token, tok);
    $("rqb-cfg-msg").textContent = T.testing;
    const ok = await health();
    $("rqb-cfg-msg").textContent = ok ? T.okConn : T.badConn;
    if (ok) setTimeout(() => toggleCfg(false), 800);
  };

  // ---------- ask ----------
  async function ask() {
    const question = input.value.trim(); if (!question || busy) return;
    const { url, token } = conn(); if (!url || !token) { toggleCfg(true); return; }
    if (body.querySelector(".rqb-empty")) body.innerHTML = "";
    addMsg("q", question, ctx); input.value = "";
    const sent = { ...ctx }; setCtx("", "");
    busy = true; sendBtn.disabled = true;
    const thinking = addMsg("thinking", T.thinking(0)); const t0 = Date.now();
    const tick = setInterval(() => { thinking.querySelector(".rqb-bub").textContent = T.thinking(Math.round((Date.now() - t0) / 1000)); }, 1000);
    const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 7 * 60 * 1000);
    try {
      const r = await fetch(url + "/ask", { method: "POST", signal: ac.signal,
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ reportId: CFG.reportId, question, quote: sent.quote, ref: sent.ref, threadId }) });
      const j = await r.json().catch(() => ({}));
      thinking.remove();
      if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
      threadId = j.threadId; threadSession = j.sessionId || null; renderSession(); addMsg("a", j.answer); setStatus("ok", $("rqb-status").textContent);
    } catch (e) {
      thinking.remove();
      addMsg("err", e.name === "AbortError" ? T.timeout : (e.message === "Failed to fetch" ? T.offline : e.message));
    } finally { clearInterval(tick); clearTimeout(to); busy = false; sendBtn.disabled = false; }
  }
  sendBtn.onclick = ask;
  // Enter sends, Shift+Enter inserts a newline; ignore Enter while an IME (e.g. Chinese pinyin) is composing
  input.addEventListener("keydown", e => {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing || e.keyCode === 229) return;
    e.preventDefault(); ask();
  });

  function addMsg(kind, text, c) {
    const d = document.createElement("div");
    d.className = "rqb-msg " + ({ q: "rqb-q", a: "rqb-a", err: "rqb-err", thinking: "rqb-a" }[kind]);
    const who = { q: T.you, a: T.claude, err: T.error, thinking: T.claude }[kind];
    const quote = c && c.quote ? `<div class="rqb-quote">${esc((c.ref ? `[${c.ref}] ` : "") + c.quote)}</div>` : "";
    d.innerHTML = `<div class="rqb-who">${who}</div>${quote}<div class="rqb-bub ${kind === "thinking" ? "rqb-thinking" : ""}">${kind === "a" ? md(text) : esc(text)}</div>`;
    body.appendChild(d); body.scrollTop = body.scrollHeight; return d;
  }

  // minimal markdown: fenced code, tables, headings, lists, bold, inline code
  function md(src) {
    const lines = String(src || "").replace(/\r/g, "").split("\n"); const out = []; let i = 0;
    const inl = s => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
    const isRow = l => /^\s*\|.*\|\s*$/.test(l);
    while (i < lines.length) {
      const l = lines[i];
      if (/^```/.test(l)) { const b = []; i++; while (i < lines.length && !/^```/.test(lines[i])) b.push(lines[i++]); i++; out.push(`<pre>${esc(b.join("\n"))}</pre>`); continue; }
      if (isRow(l) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
        const cells = r => r.trim().replace(/^\||\|$/g, "").split("|").map(x => x.trim());
        let h = `<table><thead><tr>${cells(l).map(x => `<th>${inl(x)}</th>`).join("")}</tr></thead><tbody>`; i += 2;
        while (i < lines.length && isRow(lines[i])) h += `<tr>${cells(lines[i++]).map(x => `<td>${inl(x)}</td>`).join("")}</tr>`;
        out.push(h + "</tbody></table>"); continue;
      }
      const hm = l.match(/^(#{1,4})\s+(.*)/); if (hm) { const n = hm[1].length + 1; out.push(`<h${n}>${inl(hm[2])}</h${n}>`); i++; continue; }
      if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
        const ord = /^\s*\d+\./.test(l); const items = [];
        while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(`<li>${inl(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ""))}</li>`);
        out.push(ord ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`); continue;
      }
      if (!l.trim()) { i++; continue; }
      const p = []; while (i < lines.length && lines[i].trim() && !/^(```|#{1,4}\s|\s*([-*]|\d+\.)\s|\s*\|)/.test(lines[i])) p.push(lines[i++]);
      if (!p.length) p.push(lines[i++]);
      out.push(`<p>${inl(p.join("\n")).replace(/\n/g, "<br>")}</p>`);
    }
    return out.join("");
  }

  health();
})();
