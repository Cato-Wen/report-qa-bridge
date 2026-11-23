// `claude --restricted` loads no user/plugin skills. We copy only the author's selected skills
// into a throwaway plugin ("rqb") and load it with --plugin-dir, so they appear as "rqb:<name>".
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const PLUGIN_NAME = "rqb";

function* walkSkillDirs(root, depth = 0) {
  if (depth > 7 || !fs.existsSync(root)) return;
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".trash") || e.name === "node_modules") continue;
    const p = path.join(root, e.name);
    if (e.name === "skills") yield p;
    else yield* walkSkillDirs(p, depth + 1);
  }
}

export function skillRoots(cwd) {
  const home = os.homedir();
  return [
    path.join(home, ".claude", "skills"),
    path.join(cwd, ".claude", "skills"),
    ...walkSkillDirs(path.join(home, ".claude", "plugins")),
  ];
}

/** "wonder-cookbook" or "superpowers:brainstorming" -> directory containing SKILL.md */
export function resolveSkill(name, cwd) {
  const short = String(name).split(":").pop();
  for (const root of skillRoots(cwd)) {
    const dir = path.join(root, short);
    if (fs.existsSync(path.join(dir, "SKILL.md"))) return dir;
  }
  throw new Error(`skill "${name}" not found (looked in ~/.claude/skills, <cwd>/.claude/skills, ~/.claude/plugins)`);
}

/** Build the throwaway plugin; returns the invocable names, e.g. ["rqb:wonder-cookbook"]. */
export function buildSkillPlugin(names, cwd, outDir) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, ".claude-plugin"), { recursive: true });
  fs.writeFileSync(path.join(outDir, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: PLUGIN_NAME, version: "0.0.0", description: "report-qa-bridge: skills selected by the report author" }));
  const invocable = [];
  for (const n of names) {
    const src = resolveSkill(n, cwd);
    const short = path.basename(src);
    fs.cpSync(src, path.join(outDir, "skills", short), { recursive: true });
    invocable.push(`${PLUGIN_NAME}:${short}`);
  }
  return invocable;
}
