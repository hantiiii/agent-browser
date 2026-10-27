# Agent Smith Browser (ASB)

The agent is already in the system. Attach-first a11y+refs for AI agents, with advisory canvas hints (`screenshot`, `click_xy`, `hints.mode`). Drive the real Chrome or Edge on that person's computer as accessibility-tree text with stable `eN` refs. Same core behind an **MCP server** and a small **CLI**. MIT.

**Names.** Display name: **ASB** (Agent Smith Browser). npm package and GitHub repository: `agent-smith-browser`. CLI binaries: `asb` and `agent-browser` (one program). After the GitHub rename, `https://github.com/hantiiii/agent-browser` redirects to `https://github.com/hantiiii/agent-smith-browser`.

## Why

Screenshot-and-click agents spend a lot of tokens and still miss. Sites with bot mitigation also refuse managed or headless Chromium. `goto` waits only for `domcontentloaded`, so a snapshot in the same breath often lands on an empty shell, a half-rendered SPA, or a challenge page.

Humans and agents need a thinner view: accessibility-tree text, stable `eN` refs, and actions by those refs. When the managed browser is what gets blocked, or the task needs cookies and a geo-correct IP that already exist, attach to the **real** Chrome or Edge on that person's computer, then wait until the UI is actually in the tree (`--settle-ms` / `settleMs`). Managed Chromium remains the right default for simple public pages such as example.com.

## When to use this

- **Attach first** to the user's own Chrome or Edge over CDP (`http://127.0.0.1:9222`) when you need a logged-in, geo-correct session, or when the site blocks headless Chromium. **Booking, eBay, Airbnb, and Allegro block headless** — attach, then wait until the UI appears. In a maintainer pass, managed Chromium returned an empty tree (Booking), a "SORRY" wall (eBay), or a thin tree (Airbnb). Attach did not save an immediate snapshot: Booking was still empty, and eBay still raced to "SORRY". After the attached page settled for about 8–10 seconds, Booking showed a real UI (about 266 refs in that run) and eBay did too (about 141). Airbnb's attached tree was much fuller after the same kind of wait. Treat Allegro/DataDome the same way. This is not a bypass: no fingerprint spoofing, no captcha solving, no promise the wall stays down.
- **Board Game Arena, Tabletopia, and Kurnik-style lobbies** are safe attach-first a11y targets when a skin or layout shift would break a hand-maintained pixel map. That same pass snapshotted Board Game Arena and Tabletopia in both modes. Attach produced the better Board Game Arena lobby tree; managed was often still mid-SPA load. Tabletopia snapshotted cleanly either way. Same snapshot/act tools as any other page. There is no game-specific API.
- **Drive forms and dashboards by refs** (`snapshot` → `act` → `snapshot`) instead of screenshots or coordinate maps: admin panels, SaaS settings, GitHub and GitLab UI.
- **MCP and CLI for compact text.** Cursor, Claude Desktop, and other MCP clients that want a short tree, plus one-shot CLI commands. Refs stay the default. `screenshot` and `click_xy` are for pages whose hints say the tree is not enough. example.com passed managed and attach with no extra wait.

Managed Chromium is appropriate for simple sites. For hardened marketplaces, attach and settle. Do not expect managed mode to clear them.

## How agents should loop

**snapshot → act → snapshot.** The long-lived loop is the MCP server (one process, one session). Each CLI command is one-shot and does not keep refs between processes.

1. `snapshot` returns compact text. Actionable elements get refs: `button "Sign In" [ref=e2]`. Headings, text, and images may appear in the tree and do not consume a ref.
2. `act` that ref: `click`, `type` (replaces the field value), or `press` with a Playwright key name (`Enter`, `Tab`, `ArrowDown`, …).
3. If the page may have changed, `snapshot` again before the next action. A click (`act` or `click_xy`) that opens a popup (`window.open`, `target=_blank`) moves the session onto that new page when it appears in the same browser context. The next snapshot reads the popup.
4. Read the `hints` line on that snapshot. It does not change the loop. For `canvas` or `mixed`, see **Canvas, mixed, and sparse pages**.

`goto` still returns at `domcontentloaded`. On a SPA or a bot interstitial, pass a settle pause before you trust the tree: CLI `--settle-ms <n>` (on `goto`, `snapshot`, `screenshot`, `click-xy`, or `act`) or MCP `settleMs` on `goto`, `snapshot`, and `screenshot`. Default is `0` on every one of those calls, including `click_xy` and `act` click/press, so a canvas loop stays fast when you omit it. `8000`–`10000` matched the Booking, eBay, and Airbnb attach checks above. The maximum is `30000`. With `snapshot <url>`, the pause happens once, after navigation. On an already open attached tab, it happens before the tree is read. On one-shot `act`, `--settle-ms` pauses the snapshot before the action, not after the click. Settle is a plain wait added on top of `domcontentloaded`. It is not `networkidle`, and it does not defeat a challenge by itself. Do not pass it on each dice click.

Refs from the last successful snapshot stop being valid after any of:

- a successful `goto`
- an `act` or `click_xy` that changes the document URL, or that moves the active page to a popup (`click` does not wait for navigation)
- a stale-ref error on `act` (the error says to snapshot again; the tool does not pick another element)
- `attach` or `detach`
- a new `snapshot` (it replaces the ref table)

`goto` waits for `domcontentloaded`, never `networkidle`. The session keeps one active page. `act` and `click_xy` follow a popup or new page opened by that action in the same browser context and make the most recently opened one active. `goto` stays on the URL you opened; pages already in the context stay in the background. Listing or switching tabs is out of scope.

Refs resolve with `getByRole` plus `.nth(i)`. Whitespace in the accessible name, including non-breaking spaces (`\u00a0`), is collapsed, so a snapshot name like `Go In` still matches `Go\u00a0In`. Two elements with the same role and normalized name depend on document order and can be ambiguous.

## Canvas, mixed, and sparse pages

`snapshot` and `act` stay the default. Every snapshot adds one advisory line:

```text
hints: {"mode":"a11y","reasons":["…"]}
```

`mode` is one of:

- **a11y** — the tree is a usable description. Keep using refs.
- **canvas** — the largest `<canvas>` covers at least 60% of the viewport, and fewer than 3 controls sit outside it.
- **mixed** — that canvas is present, and at least 3 controls sit outside it (chrome around a stage). A control counts as outside when its center lies outside the canvas box.
- **sparse** — nothing is canvas-heavy, and the tree is empty or nearly empty (no actionable refs, and at most 3 interesting nodes).

Hints come from the live accessibility tree and from canvas boxes in the open page. There is no site list and no saved playbook. The library does not switch tools, run OCR or a vision model, or solve a captcha.

When the mode is `canvas` or `mixed`, call `screenshot` and `click_xy` yourself. The default screenshot is the viewport, one PNG pixel per CSS pixel, so it lines up with `click_xy`. `click_xy` defaults to CSS pixels from the top-left of the viewport. `space: "normalized"` (CLI `--space normalized`) takes `x` and `y` in the 0–1 range. Both responses include the viewport size. `--full` / `fullPage: true` captures the scrollable page and is not a coordinate map for `click_xy`.

Canvas and mixed loops omit `settleMs`. `click_xy` returns as soon as the click is delivered and does not sleep for the next paint. Take the next screenshot immediately. If you need the new frame, pass `awaitPaint: true` (CLI `--await-paint`): the screenshot waits at most about 100ms for the largest canvas to change, or for two animation frames when the page has no canvas, then returns the image either way. The result includes `painted` (`true` when that change or those frames were seen). A multi-second sleep between dice clicks is the slow path. A large `settleMs` is only for a SPA shell or a bot interstitial that has not drawn a tree yet.

`snapshot` and `screenshot` include `url` and `pageChanged`. `pageChanged` is true when this read is a different page or URL than the previous snapshot or screenshot in the same session, which is what you see after a click opens a popup.

## Install

```bash
npm install -g agent-smith-browser
asb …                    # short command
agent-browser …          # same CLI
npx --yes --package agent-smith-browser asb …
npx playwright install chromium     # managed browser for the default mode
```

```bash
git clone https://github.com/hantiiii/agent-smith-browser.git
```

Requires Node 20+.

## Use with an MCP client

```json
{
  "mcpServers": {
    "agent-smith-browser": {
      "command": "npx",
      "args": ["-y", "--package", "agent-smith-browser", "asb", "mcp"]
    }
  }
}
```

The MCP server identifier is `agent-smith-browser`. Clients that show a title see **Agent Smith Browser**. `agent-browser mcp` starts the same server.

Tools: `goto(url, settleMs?)`, `snapshot(settleMs?)` (text includes `hints`), `act(ref, kind, value?)`, `screenshot(fullPage?, settleMs?, awaitPaint?)`, `click_xy(x, y, space?)`, `attach(cdpUrl)`, `detach()`. `settleMs` defaults to 0. `click_xy` has no paint wait.

Call `attach("http://127.0.0.1:9222")` before `goto` when the site should see the user's real browser. Otherwise the first `goto` or `snapshot` launches managed Chromium. Pass `settleMs` when the tree would otherwise be read too early. See **How agents should loop** for ref lifetime, settle, and the one active page (including a popup a click just opened).

## CLI

Every command is one-shot (no daemon, no REPL, no session file). For multi-step flows use MCP.

```bash
asb demo                                            # example.com snapshot smoke
agent-browser demo                                  # same binary as asb
asb goto https://example.com
asb snapshot https://example.com
asb snapshot --cdp http://127.0.0.1:9222            # current tab of your Chrome
asb snapshot --cdp http://127.0.0.1:9222 --settle-ms 10000
asb act e3 click --cdp http://127.0.0.1:9222
asb screenshot https://example.com --out /tmp/page.png
asb click-xy 0.5 0.5 --space normalized --cdp http://127.0.0.1:9222
asb attach http://127.0.0.1:9222                    # check endpoint is reachable
asb mcp                                             # MCP stdio server
```

`--settle-ms` defaults to `0` (integer, max `30000`). On `snapshot <url>`, `screenshot <url>`, `click-xy` with a url, and `goto` it pauses after `domcontentloaded`. On a current-tab `snapshot`, `screenshot`, `click-xy`, or `act` it pauses before that command. `act` requires `--cdp`: it snapshots the attached tab, then acts. A managed one-shot would open a blank browser and exit. One-shot `click-xy` needs `--cdp` or a url.

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

If `act` or `click_xy` opens a window, the session follows that window. Later snapshot, screenshot, and click commands use it. The previous tab stays open. The session still drives one page at a time.

> **Trust warning:** attaching gives the agent process full control of that browser profile: cookies, logged-in sessions, and keyboard/mouse input. Only attach to a browser (or a dedicated profile) you are comfortable handing over.

Attach uses Playwright `connectOverCDP`. It drives your real browser.

## Non-goals (MVP)

- No stealth, no fingerprint / UA / TLS spoofing, no captcha solving, and no guarantee against DataDome or any other bot mitigation. `--settle-ms` only waits.
- Managed Chromium is for simple sites (example.com passed). Booking, eBay, Airbnb, and Allegro-style pages need attach, then a settle until the UI is in the tree. Managed mode did not clear those pages.
- No OCR or vision model in this library, and no silent fallback from refs to pixels. `screenshot` and `click_xy` run only when you call them. `hints` are advisory.
- No site playbooks and no URL lists. Canvas, mixed, and sparse come from the open page.
- No `extract` helper, no multi-tab API, no file chooser or native dialogs. A popup opened by `act` or `click_xy` is followed when it appears, and then it is the one active page.
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
