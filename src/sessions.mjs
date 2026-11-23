// Locate Claude Code session transcripts (~/.claude/projects/<encoded cwd>/<id>.jsonl).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const projectDirFor = cwd =>
  path.join(os.homedir(), ".claude", "projects", path.resolve(cwd).replace(/[^a-zA-Z0-9]/g, "-"));

function entrypointOf(file) {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(256 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    for (const line of buf.subarray(0, n).toString("utf8").split("\n")) {
      try { const e = JSON.parse(line); if (e.entrypoint) return e.entrypoint; } catch {}
    }
  } finally { fs.closeSync(fd); }
  return null;
}

/** Most recently written interactive (entrypoint=cli) session for this cwd — i.e. the one you are in. */
export function findCurrentSession(cwd) {
  const dir = projectDirFor(cwd);
  if (!fs.existsSync(dir)) throw new Error(`no Claude Code sessions found for ${cwd} (${dir})`);
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".jsonl"))
    .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
  for (const { f } of files) {
    if (entrypointOf(path.join(dir, f)) === "cli") return f.replace(/\.jsonl$/, "");
  }
  throw new Error(`no interactive session found in ${dir}`);
}

export const sessionExists = (cwd, id) => fs.existsSync(path.join(projectDirFor(cwd), `${id}.jsonl`));
