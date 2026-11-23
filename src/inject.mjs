// Inline the ask widget + its config into an HTML file (idempotent).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WIDGET = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "widget", "ask-widget.js");
const BLOCK_RE = /\n?<!-- rqb:begin -->[\s\S]*?<!-- rqb:end -->\n?/g;

export function injectWidget(html, cfg) {
  const widget = fs.readFileSync(WIDGET, "utf8").replace(/<\/script/gi, "<\\/script");
  const json = JSON.stringify(cfg).replace(/</g, "\\u003c");
  const block = `\n<!-- rqb:begin -->\n<script type="application/json" id="rqb-config">${json}</script>\n<script id="rqb-widget">\n${widget}\n</script>\n<!-- rqb:end -->\n`;
  const clean = html.replace(BLOCK_RE, "\n");
  const i = clean.toLowerCase().lastIndexOf("</body>");
  return i >= 0 ? clean.slice(0, i) + block + clean.slice(i) : clean + block;
}

export const hasWidget = html => /<!-- rqb:begin -->/.test(html);

export function injectFile(file, cfg) {
  const html = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, injectWidget(html, cfg));
}
