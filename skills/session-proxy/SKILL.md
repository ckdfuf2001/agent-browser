---
name: session-proxy
description: Session-isolated browser workflow for the agent-browser MCP proxy. Read this before any browser task: scope rules, ensure/reuse flow, snapshot-and-ref loop, tabs, waits, troubleshooting. Korean session names allowed.
---

# Session Proxy skill

You drive browsers through 36 typed MCP tools (`agent_browser_*`) on ONE shared
daemon. Concurrent tasks MUST NOT share a browser. The rules below replace the
upstream CLI skill (`AGENT_BROWSER_SESSION` env, `session id`, 62 tools) — do
not follow those here.

## 1. Scope rules (every call)

- Pass BOTH `namespace` ("opencode", always) and `session` on EVERY call.
  No silent defaults. Missing/foreign values are rejected with guidance.
- One task = one `session`. Never reuse another task's session, never "default".
- Korean names are fine (`결제-확인`). Letters/numbers/`-`/`_` only, max 64 chars.

## 2. Start every task with ensure

```
agent_browser_session_ensure { namespace: "opencode", task: "checkout" }
```

- Fresh name → `session ready: "checkout-a1b2c3"`. Reuse it for the whole task.
- Already tracked here → `already tracked`, keep going.
- `EXISTS` + tab list → that browser is LIVE but unknown to this proxy.
  Only re-call with `reuse:true` if it is YOUR browser from earlier work.
  Otherwise pick another name. Never guess session names.

## 3. Core loop

```
open (url) → snapshot → click/fill/type (fresh @refs) → snapshot → …
```

- `snapshot` after EVERY navigation/tab switch and BEFORE every interaction.
- Refs (`@e1`, `@e2`…) expire on navigation, tab switch, re-render. Stale ref →
  snapshot again, use the NEW refs. Bare `e12` is auto-fixed to `@e12`.
- Slow/SPA pages: `wait_load { state: "networkidle" }` (or `wait_text`), then snapshot.
- First `open` of a session can take ~35s (cold browser launch); later calls take 1–2s.
  If `open` reports extra time, the page IS loaded — snapshot next.

## 4. Tabs

- `tab_list` → stable ids (`t1`, `t2`…) and labels. Prefer `--label` at `tab_new`.
- `tab_switch` first, THEN snapshot — refs belong to the active tab.
- Closing a tab onto a discarded one reloads it; re-snapshot.

## 5. Reads without a browser

- `read { url }` fetches article/docs text with NO browser (cheap first step).
- Omit `url` to read the active tab — then `session` IS required.

## 6. Troubleshooting

| Symptom | Do |
|---|---|
| timeout / timed out | wait, `snapshot` again with SAME session+namespace |
| stale ref / not found / `@eN` error | fresh `snapshot`, use NEW refs |
| covered by banner/modal | dismiss it, snapshot, retry |
| `tab_gone` | `tab_list`, then `tab_new` or `tab_switch`, snapshot |
| JS dialog blocks | handle it before interacting |
| Unknown pair → "call ensure first" | `session_ensure` with that pair; adopt via `reuse:true` only if yours |
| `EXISTS` for a stranger's session | pick another name |

## 7. Finish

- `agent_browser_close` with your pair when done. Or leave it: idle sessions
  auto-close after TTL. Sessions with in-flight calls are never touched.
- `agent_browser_session_cleanup { all:true }` closes idle tracked sessions only.
