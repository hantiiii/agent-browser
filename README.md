# agent-browser

Attach to the user's real Chrome or Edge and drive the page as accessibility-tree text with stable `eN` refs. Same core behind an **MCP server** and a small **CLI**. MIT.

## Why

Screenshot-and-click agents spend a lot of tokens and still miss. Sites with bot mitigation also refuse managed or headless Chromium. `goto` waits only for `domcontentloaded`, so a snapshot in the same breath often lands on an empty shell, a half-rendered SPA, or a challenge page.

Humans and agents need a thinner view: accessibility-tree text, stable `eN` refs, and actions by those refs. When the managed browser is what gets blocked, or the task needs cookies and a geo-correct IP that already exist, attach to the **real** Chrome or Edge on that person's computer, then wait until the UI is actually in the tree (`--settle-ms` / `settleMs`). Managed Chromium remains the right default for simple public pages such as example.com.

## When to use this

- **Attach first** to the user's own Chrome or Edge over CDP (`http://127.0.0.1:9222`) when you need a logged-in, geo-correct session, or when the site blocks headless Chromium. **Booking, eBay, Airbnb, and Allegro block headless** — attach, then wait until the UI appears. In a maintainer pass, managed Chromium returned an empty tree (Booking), a "SORRY" wall (eBay), or a thin tree (Airbnb). Attach did not save an immediate snapshot: Booking was still empty, and eBay still raced to "SORRY". After the attached page settled for about 8–10 seconds, Booking showed a real UI (about 266 refs in that run) and eBay did too (about 141). Airbnb's attached tree was much fuller after the same kind of wait. Treat Allegro/DataDome the same way. This is not a bypass: no fingerprint spoofing, no captcha solving, no promise the wall stays down.
- **Board Game Arena, Tabletopia, and Kurnik-style lobbies** are safe attach-first a11y targets when a skin or layout shift would break a hand-maintained pixel map. That same pass snapshotted Board Game Arena and Tabletopia in both modes. Attach produced the better Board Game Arena lobby tree; managed was often still mid-SPA load. Tabletopia snapshotted cleanly either way. Same snapshot/act tools as any other page. There is no game-specific API.
- **Drive forms and dashboards by refs** (`snapshot` → `act` → `snapshot`) instead of screenshots or coordinate maps: admin panels, SaaS settings, GitHub and GitLab UI.
- **MCP and CLI for compact text.** Cursor, Claude Desktop, and other MCP clients that want a short tree, plus one-shot CLI commands. There is no screenshot or vision path in this MVP. example.com passed managed and attach with no extra wait.

Managed Chromium is appropriate for simple sites. For hardened marketplaces, attach and settle. Do not expect managed mode to clear them.

## How agents should loop

**snapshot → act → snapshot.** The long-lived loop is the MCP server (one process, one session). Each CLI command is one-shot and does not keep refs between processes.

1. `snapshot` returns compact text. Actionable elements get refs: `button "Sign In" [ref=e2]`. Headings, text, and images may appear in the tree and do not consume a ref.
2. `act` that ref: `click`, `type` (replaces the field value), or `press` with a Playwright key name (`Enter`, `Tab`, `ArrowDown`, …).
3. If the page may have changed, `snapshot` again before the next action.

`goto` still returns at `domcontentloaded`. On a SPA or a bot interstitial, pass a settle pause before you trust the tree: CLI `--settle-ms <n>` (on `goto`, `snapshot`, or `act`) or MCP `settleMs` on `goto` and `snapshot`. Default is `0`, so example.com stays fast. `8000`–`10000` matched the Booking, eBay, and Airbnb attach checks above. The maximum is `30000`. With `snapshot <url>`, the pause happens once, after navigation. On an already open attached tab, it happens before the tree is read. Settle is a plain wait added on top of `domcontentloaded`. It is not `networkidle`, and it does not defeat a challenge by itself.

Refs from the last successful snapshot stop being valid after any of:

- a successful `goto`
- an `act` that changes the document URL (`click` does not wait for navigation)
- a stale-ref error on `act` (the error says to snapshot again; the tool does not pick another element)
- `attach` or `detach`
- a new `snapshot` (it replaces the ref table)

`goto` waits for `domcontentloaded`, never `networkidle`. Scope is the active tab only. Refs resolve with `getByRole(role, { name }).nth(i)`, so two elements with the same role and name depend on document order and can be ambiguous.

## Install

```bash
npm install -g agent-browser        # or: npx agent-browser …
npx playwright install chromium     # managed browser for the default mode
```

Requires Node 20+.

## Use with an MCP client

```json
{
  "mcpServers": {
    "agent-browser": {
      "command": "npx",
      "args": ["-y", "agent-browser", "mcp"]
    }
  }
}
```

Tools: `goto(url, settleMs?)`, `snapshot(settleMs?)`, `act(ref, kind, value?)`, `attach(cdpUrl)`, `detach()`.

Call `attach("http://127.0.0.1:9222")` before `goto` when the site should see the user's real browser. Otherwise the first `goto` or `snapshot` launches managed Chromium. Pass `settleMs` when the tree would otherwise be read too early. See **How agents should loop** for ref lifetime, settle, and the active-tab limit.

## CLI

Every command is one-shot (no daemon, no REPL, no session file). For multi-step flows use MCP.

```bash
agent-browser demo                                  # example.com snapshot smoke
agent-browser goto https://example.com
agent-browser snapshot https://example.com
agent-browser snapshot --cdp http://127.0.0.1:9222  # current tab of your Chrome
agent-browser snapshot --cdp http://127.0.0.1:9222 --settle-ms 10000
agent-browser act e3 click --cdp http://127.0.0.1:9222
agent-browser attach http://127.0.0.1:9222          # check endpoint is reachable
agent-browser mcp                                   # MCP stdio server
```

`--settle-ms` defaults to `0` (integer, max `30000`). On `snapshot <url>` and `goto` it pauses after `domcontentloaded`. On a current-tab `snapshot` or `act` it pauses before that snapshot. `act` requires `--cdp`: it snapshots the attached tab, then acts. A managed one-shot would open a blank browser and exit.

## Attach to your own Chrome or Edge

Works on any user's computer that runs Chrome or Edge.

1. Quit the browser fully, then start it with remote debugging bound to localhost:

   ```bash
   # macOS
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
     --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222
   # Windows
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222
   # Linux
   google-chrome --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222
   ```

   Edge takes the same flags (`msedge`). Recent Chrome versions may require a separate `--user-data-dir=<dir>` for remote debugging.
2. Check it: open `http://127.0.0.1:9222/json/version`.
3. Run the agent on the same computer and call `attach("http://127.0.0.1:9222")` (a `ws://…` endpoint also works). If the agent runs elsewhere, use a secure tunnel or a local bridge you trust. Never expose the port on `0.0.0.0`.
4. If the tab is still a spinner or an interstitial, snapshot with `settleMs` / `--settle-ms` (about `8000`–`10000` on the Booking, eBay, and Airbnb checks) and read the tree again. Attach does not wait by itself.
5. `detach()` disconnects and leaves your browser running.

> **Trust warning:** attaching gives the agent process full control of that browser profile: cookies, logged-in sessions, and keyboard/mouse input. Only attach to a browser (or a dedicated profile) you are comfortable handing over.

Attach uses Playwright `connectOverCDP`. It drives your real browser.

## Non-goals (MVP)

- No stealth, no fingerprint / UA / TLS spoofing, no captcha solving, and no guarantee against DataDome or any other bot mitigation. `--settle-ms` only waits.
- Managed Chromium is for simple sites (example.com passed). Booking, eBay, Airbnb, and Allegro-style pages need attach, then a settle until the UI is in the tree. Managed mode did not clear those pages.
- No screenshot or vision path, no `extract` helper, no multi-tab API, no file chooser or native dialogs.
- No SaaS or cloud component.

## Later

- **Firefox** attach via WebDriver BiDi (Firefox does not speak Chromium CDP) with the same snapshot/act contract.
- Optional persistent profiles / proxy as plugins.

## Development

```bash
npm install && npx playwright install chromium
npm run build
npm test                                   # unit + managed integration
ATTACH_CDP_URL=http://127.0.0.1:9222 npx vitest run tests/integration/attach.test.ts   # optional attach smoke
```

## Support development

If this helps your agent stack, consider supporting development.

**BTC Donation Address:**
`1HANfVCfy9CFp5JAjNBhKWPWbavjXxdCRR`

## License

MIT
