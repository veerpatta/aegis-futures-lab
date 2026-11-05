# BrowserStack - real-browser and real-device testing

> **This repo:** aegis-futures-lab | **Local dev:** `npm run dev` -> http://localhost:3000 | **Live:** https://aegis-futures-lab-khaki.vercel.app
>
> Run the local e2e suite first (`npm run test:e2e`).

BrowserStack gives agents and people real browsers and real phones in the cloud: Safari on iPhone, Chrome on Android, Edge and Firefox on Windows, Safari on macOS. Janmejay's account comes with the GitHub Student Developer Pack (free one-year licence; BrowserStack lists it as Live + Automate Mobile). It is set up for every veerpatta project, so use it whenever a change could look or behave differently outside desktop Chrome.

## When to use it

- After UI, CSS, layout, PWA / service-worker or mobile-specific changes - before calling the task done.
- When someone reports "it looks broken on my phone" and it doesn't reproduce locally.
- Not needed for pure backend, data, script or docs changes.

Local checks (unit tests, local Playwright / Chromium) still come first; BrowserStack covers what local Chromium can't show. If BrowserStack isn't reachable (no sign-in, plan limit, network), say so in your summary and carry on - it is never a blocker.

## Default device set (pick the 2-3 that fit the change)

| Who | Browser / device |
|---|---|
| Most parents, staff and guests | Chrome on Android (Samsung Galaxy A-series or Redmi, Android 13-14) |
| iPhone users | Safari on iPhone (iOS 17 or 18) |
| Office desktops | Chrome and Edge on Windows 11 |
| Mac users | Safari on macOS |
| Small screens | any 360 x 640 Android phone |

## Route A - BrowserStack MCP server (Claude Code, Codex, Cursor, VS Code)

This repo's `.mcp.json` registers BrowserStack's official remote MCP server:

```json
"browserstack": { "type": "http", "url": "https://mcp.browserstack.com/mcp" }
```

- **Claude Code, first use on a machine:** run `/mcp`, pick `browserstack`, sign in with the BrowserStack account (linked to GitHub `veerpatta`). The sign-in is remembered. `.claude/settings.json` pre-approves the server and its tools.
- **Codex (user level, once):** `codex mcp add browserstack --url https://mcp.browserstack.com/mcp`, then `codex mcp login browserstack`.
- **Cursor:** add `"browserstack": { "url": "https://mcp.browserstack.com/mcp" }` under `mcpServers` in `~/.cursor/mcp.json`.

How to use it: the server exposes a small catalog - `listProducts`, `describeEntity`, `searchCapability`, `describeCapability`, `invokeCapability`. Search for what you need in plain language, then invoke it. For example:

- "open https://... on Safari, iPhone 15"
- "take screenshots of https://... on Android Chrome and iPhone Safari"
- "run an accessibility scan of https://..."

Limits to know:

- The remote server **cannot reach localhost**. Test a preview or production URL, or use Route A2 or Route B.
- A Live session returns a link that a person (or a Chrome-driving agent, Route B) opens.
- Automated runs (Playwright / Selenium on remote browsers) depend on the plan. If a capability says the plan doesn't include it, fall back to Route B or report it.

### Route A2 - local MCP server with keys (adds localhost testing)

Optional. Set it up once per machine at **user** scope, so the keys never go in a repo:

```powershell
# Windows (Janmejay's PC) - npx has to go through cmd /c
claude mcp add --scope user browserstack-local -e BROWSERSTACK_USERNAME=<username> -e BROWSERSTACK_ACCESS_KEY=<access key> -- cmd /c npx -y @browserstack/mcp-server@latest
```

```bash
# macOS / Linux
claude mcp add --scope user browserstack-local -e BROWSERSTACK_USERNAME=<username> -e BROWSERSTACK_ACCESS_KEY=<access key> -- npx -y @browserstack/mcp-server@latest
```

Needs Node 22+. The username and access key are in BrowserStack's account settings. Ask it to open `http://localhost:<port>` on a device; it tunnels to this machine with BrowserStack Local.

## Route B - BrowserStack Live in Janmejay's Chrome (Cowork / Claude in Chrome)

Janmejay's Chrome has the BrowserStack extension installed and is signed in, so an agent that drives Chrome needs no keys:

1. Open https://live.browserstack.com/dashboard in a new tab (or click the BrowserStack extension while on the page to test).
2. Pick the OS, then the browser or device.
3. Load the URL. For localhost, Live offers to start BrowserStack Local - or test the preview / production URL instead.
4. Work through the check with screenshots and clicks. Remote sessions are slower than local ones, so keep checks focused.
5. End the session when done so the slot is free.

## Which URL to test

- Prefer the local dev server (Route A2 or B) or a preview deployment.
- Production is fine for read-only looking around. Don't create, edit, pay or delete real records from a remote session.
- Use test accounts. Don't type real staff, parent or guest passwords into a remote browser.

## Reporting

In the PR description or final summary, list the devices and browsers checked, what was looked at, and anything that broke (with screenshots when available).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `browserstack` shows "needs authentication" | Run `/mcp`, pick `browserstack`, sign in. Until then use Route B or local checks. |
| Claude Code asks to approve the project MCP server | Approve once. |
| A localhost URL won't load | The remote server can't reach localhost - use Route A2, Route B or a preview URL. |
| "Plan does not include ..." | The student licence is Live + Automate Mobile. Use Route B, or note it and move on. |
| `browserstack-local` won't start | `node --version` must be 22+; on Windows the command must go through `cmd /c`. |
| Keys or sign-in missing entirely | Not a blocker - run the local checks, note "BrowserStack not checked" in the summary. |
