// Smoke test v2.2 contract (no browser needed):
// namespace+session explicit every call; unknown-pair gating; reuse schema.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const CLI = "C:\\Users\\oh\\Downloads\\opencode-webui-portable-0.3.14-win-x64\\bin\\agent-browser\\bin\\agent-browser.exe";
const child = spawn("node", [path.join(dir, "mcp-server.mjs"), "--cli", CLI, "--namespace", "opencode"], {
  stdio: ["pipe", "pipe", "pipe"],
  env: Object.assign({}, process.env, { SESSION_TTL_MS: "600000", SESSION_MAX: "16" }),
});
child.stderr.on("data", () => {});
let buf = "";
const waiters = new Map();
child.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const m = JSON.parse(line);
    const w = waiters.get(m.id);
    if (w) { waiters.delete(m.id); w(m); }
  }
});
let seq = 1;
const req = (method, params = {}) => new Promise((resolve) => {
  const id = seq++;
  const t = setTimeout(() => { waiters.delete(id); resolve({ timeout: true }); }, 20000);
  waiters.set(id, (m) => { clearTimeout(t); resolve(m); });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
});
const R = [];
const check = (n, ok, d = "") => R.push((ok ? "PASS" : "FAIL") + " | " + n + (d ? " | " + String(d).slice(0, 120) : ""));
const body = (m) => JSON.stringify(m.result || m.error);

await req("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "s", version: "0" } });
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");

let names = [], byName = {}, cursor;
do {
  const pg = await req("tools/list", cursor ? { cursor } : {});
  for (const t of pg.result.tools || []) { names.push(t.name); byName[t.name] = t; }
  cursor = pg.result.nextCursor;
} while (cursor);
check("tool surface", names.length >= 30 && names.length <= 45, "count=" + names.length);
check("namespace required on click", (byName.agent_browser_click.inputSchema.required || []).indexOf("namespace") >= 0);
check("session required on click", (byName.agent_browser_click.inputSchema.required || []).indexOf("session") >= 0);
check("ensure has reuse flag", !!((byName.agent_browser_session_ensure.inputSchema.properties || {}).reuse));

const noNs = await req("tools/call", { name: "agent_browser_click", arguments: { selector: "@e1", session: "x" } });
check("namespace missing blocked", /`namespace` is REQUIRED/.test(body(noNs)));
const foreign = await req("tools/call", { name: "agent_browser_click", arguments: { selector: "@e1", session: "x", namespace: "other" } });
check("foreign namespace rejected", /pinned to/.test(body(foreign)));
const noSess = await req("tools/call", { name: "agent_browser_click", arguments: { selector: "@e1", namespace: "opencode" } });
check("session missing blocked", /Missing `session`/.test(body(noSess)));
const unknown = await req("tools/call", { name: "agent_browser_click", arguments: { selector: "@e1", session: "never-ensured-z9", namespace: "opencode" } });
check("unknown pair sent to ensure", /session_ensure/.test(body(unknown)));
const ens = await req("tools/call", { name: "agent_browser_session_ensure", arguments: { task: "smoke", namespace: "opencode" } });
check("ensure mints+tracks", /session ready:/.test(body(ens)));
const ensNoNs = await req("tools/call", { name: "agent_browser_session_ensure", arguments: { task: "smoke" } });
check("ensure requires namespace", /`namespace` is REQUIRED/.test(body(ensNoNs)));
const ensKo = await req("tools/call", { name: "agent_browser_session_ensure", arguments: { session: "결제-확인", namespace: "opencode" } });
check("korean session accepted", /결제-확인/.test(body(ensKo)), body(ensKo));

console.log(R.join("\n"));
const fails = R.filter((r) => r.indexOf("FAIL") === 0).length;
child.kill();
setTimeout(() => process.exit(fails ? 1 : 0), 500);
