# agent-browser

A thin browser for AI agents: **accessibility-tree snapshots with `eN` refs instead of screenshots**, and actions by ref instead of pixel clicks. Exposed as an **MCP server** and a small **CLI** on the same core. MIT.

- `snapshot` → compact text like `button "Sign In" [ref=e2]` (only actionable elements get refs)
- `act e2 click` / `act e1 type "hello"` / `act e1 press Enter`
- Optional **attach** to the user's own running Chrome/Edge, so a human sees a normal window while the agent gets the same a11y text.

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

Tools: `goto(url)`, `snapshot()`, `act(ref, kind, value?)`, `attach(cdpUrl)`, `detach()`.

Agent loop: **snapshot → act → (if the page may have changed) snapshot**. Refs are invalidated by `goto`, a navigating `act`, a stale-ref error, `attach`/`detach`, and every new `snapshot`.

- `goto` waits for `domcontentloaded` (never `networkidle`).
- `click` does not wait for navigation; `type` replaces the field value; `press` uses Playwright key names (`Enter`, `Tab`, `ArrowDown`, …).
- Scope: the active tab only.
- Known limit: refs map to `getByRole(role, { name }).nth(i)`, so elements with identical role + name rely on order and may be ambiguous.

## CLI

Every command is one-shot (no daemon, no REPL, no session file). For multi-step flows use MCP.

```bash
agent-browser demo                                  # example.com snapshot smoke
agent-browser goto https://example.com
agent-browser snapshot https://example.com
agent-browser snapshot --cdp http://127.0.0.1:9222  # current tab of your Chrome
agent-browser act e3 click --cdp http://127.0.0.1:9222
agent-browser attach http://127.0.0.1:9222          # check endpoint is reachable
agent-browser mcp                                   # MCP stdio server
```

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
3. Run the agent on the same computer and call `attach("http://127.0.0.1:9222")` (a `ws://…` endpoint also works). If the agent runs elsewhere, use a secure tunnel or a local bridge you trust — never expose the port on `0.0.0.0`.
4. `detach()` disconnects and leaves your browser running.

> **Trust warning:** attaching gives the agent process full control of that browser profile — cookies, logged-in sessions, and keyboard/mouse input. Only attach to a browser (or a dedicated profile) you are comfortable handing over.

Attach uses Playwright `connectOverCDP`. It drives your real browser; it does not fake one.

## Non-goals (MVP)

- No fingerprint/UA/TLS spoofing, no stealth plugins, no captcha solving, no guarantees against bot-mitigation (DataDome etc.).
- No screenshots / vision path, no `extract` helper, no multi-tab API, no file chooser or native dialogs.
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

## License

MIT
