import test from "node:test";
import assert from "node:assert/strict";
import { injectWidget, hasWidget } from "../src/inject.mjs";

const page = `<!DOCTYPE html><html lang="zh-CN"><head><title>T</title></head><body><p>hi</p></body></html>`;

test("inserts widget before </body>", () => {
  const out = injectWidget(page, { reportId: "r1", title: "T" });
  assert.ok(hasWidget(out));
  assert.ok(out.indexOf("rqb:end") < out.indexOf("</body>"));
  assert.match(out, /"reportId":"r1"/);
});

test("is idempotent (re-inject replaces, never duplicates)", () => {
  const once = injectWidget(page, { reportId: "r1" });
  const twice = injectWidget(once, { reportId: "r2" });
  assert.equal((twice.match(/rqb:begin/g) || []).length, 1);
  assert.match(twice, /"reportId":"r2"/);
  assert.doesNotMatch(twice, /"reportId":"r1"/);
});

test("config cannot break out of the script tag", () => {
  const out = injectWidget(page, { reportId: "r1", title: "</script><script>alert(1)</script>" });
  const cfg = out.slice(out.indexOf('id="rqb-config">'), out.indexOf("</script>", out.indexOf('id="rqb-config">')));
  assert.doesNotMatch(cfg, /<\/script/i);
});
