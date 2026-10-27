# Agent Browser — Design Spec

> **Current name:** Agent Smith Browser (ASB). npm and GitHub are `agent-smith-browser`. CLI binaries are `asb` and `agent-browser`. This spec is the original design record.

**Date:** 2026-10-27  
**Status:** draft (browser decisions locked 2026-10-27; awaiting final approve)  
**License (intended):** MIT  
**Owners:** Łukasz L + Ruda + Browser Core + Agent Browser PM

## Problem

Agents that drive the web via screenshots burn tokens and fail often. Sites like Allegro/DataDome also block automation fingerprints. Humans and agents both need a thinner, clearer view of pages.

## Goals (MVP)

1. **Cheaper perception** — accessibility-tree snapshots with stable element refs instead of vision-first screenshots.
2. **Faster agent loops** — small tool surface: navigate, see, act.
3. **Antibot lottery backup** — optional attach to a real Chromium browser on the *end user's own computer* (not a project maintainer's machine), so the human sees a normal window while the agent gets the same a11y translation.
4. **Open source** — usable from any MCP-capable agent host plus CLI for scripts.

## Non-goals (MVP)

- Breaking DataDome / Allegro (no promises; no captcha solvers; no fingerprint spoofing product).
- Spoofing UA/TLS/fingerprint inside managed Chromium to "look like" Firefox/Chrome/Edge — antibot lottery backup is **real user browser attach**, not fake identity.
- Firefox attach (Marionette/BiDi later; MVP attach is Chromium-only: Chrome/Edge).
- Empty "stealth" persistent profile product (later).
- SaaS / hosted browser fleet.
- Vision-first computer-use.
- Extract-to-JSON helper (later).
- Screenshot tool (later, emergency only).
- Multi-tab picker, OS file chooser, native dialogs.
- Cross-origin iframe magic beyond what the a11y tree already exposes.

## Approach

Own **thin core** over Playwright → Chromium CDP (not a rewrap of Playwright MCP's full surface; not a Browser Use Cloud wrapper).

Same core behind:

- **MCP server** (primary for agents)
- **CLI** (debug + scripts)

Attach uses Playwright `connectOverCDP` — no custom CDP parser (YAGNI).

## Architecture

```
┌─────────────┐   ┌─────────────┐
│  MCP server │   │     CLI     │
└──────┬──────┘   └──────┬──────┘
       └────────┬────────┘
                ▼
         ┌────────────┐
         │  Core API  │  goto | snapshot | act | attach | detach
         └─────┬──────┘
       ┌───────┴────────┐
       ▼                ▼
┌─────────────┐  ┌──────────────────┐
│  Managed    │  │  Attach backend  │
│  Chromium   │  │  connectOverCDP  │
│  (Playwright)│  │  Chrome/Edge    │
└─────────────┘  └──────────────────┘
```

### Session state machine (one global context)

States: `idle` → `managed` ↔ `attached`.

- Fresh process starts in `idle` (no browser). First `goto` or `snapshot`/`act` that needs a page launches managed Chromium → `managed`.
- `attach(cdpUrl)` disconnects managed if any (closes the managed browser), connects to the CDP endpoint → `attached`. Does not keep a second live backend.
- `detach()` disconnects CDP, leaves the user's browser running, clears refs → `idle` (does **not** auto-relaunch managed). Next `goto` starts a new managed browser.
- Only one active page context at a time: the **active tab** of the current backend.

## Tools (MVP surface)

| Tool | Behavior |
|------|----------|
| `goto(url)` | Navigate active page; wait until **`domcontentloaded`** (MVP policy; not `load`, not `networkidle`). Return short status + final URL. |
| `snapshot()` | Compact a11y tree + refs `e1`…; budget-oriented (interactive + labeled content; drop noise). |
| `act(ref, kind, value?)` | `click` / `type` / `press` on ref from **last successful snapshot**. Docs require snapshot-before-act. |
| `attach(cdpUrl)` | Accept `http://host:port` or `ws://`/`wss://` CDP endpoint; switch to attach mode. |
| `detach()` | Leave attached browser running; return to `idle`. |

No other MCP tools in v1.

### `act` contract

- **`click`:** click the ref; do **not** wait for navigation. If navigation happens, refs are invalid — agent must `snapshot` again.
- **`type`:** **replace** contents (clear then fill). `value` required. Not append.
- **`press`:** Playwright-style key names (`Enter`, `Tab`, `Escape`, `ArrowDown`, …). `value` holds the key name.
- **Stale ref:** if the node is gone or refs were invalidated → error telling the agent to call `snapshot` again. Never guess another element.

### Ref invalidation

Refs from snapshot *N* are valid until any of:

1. A successful `goto`
2. An `act` that navigates (document URL/commit change)
3. A stale-ref error on `act`
4. `attach` or `detach`
5. Explicit new `snapshot` (replaces the ref table)

Agents must treat “snapshot → act → (if page may have changed) snapshot” as the default loop.

### Tab / frame scope

MVP operates on the **active tab** only. Include same-document / a11y-exposed frames in the tree; no multi-tab API; no dedicated cross-origin pierce beyond Playwright a11y defaults.

## Attach requirements (docs must say)

Attach is for **any user's machine**, not a maintainer laptop:

1. Install Chrome or Edge on that computer.
2. Start it with remote debugging; docs default to binding **`127.0.0.1`** (never recommend `0.0.0.0`).
3. Connect an agent runtime that can reach that CDP host (localhost when the agent runs on the same machine; otherwise a secure tunnel / product-specific local bridge — **examples in appendix only**, not as hard requirements).
4. Trust warning: the agent process can use cookies and input on that profile — high trust; spell this out in README/CLI help.

Maintainer home PCs are only *dev test* environments, never a product dependency.


## Supported browsers

**Product story:** agents work with normal Chrome, Edge, or (later) Firefox windows people already use — not a weird headless bot chrome.

**MVP**
- **Managed mode:** Playwright Chromium (automation browser for cheap a11y loops).
- **Attach mode:** real **Chrome or Edge** on the end user's machine via `connectOverCDP` (human sees the real window).

**Later**
- **Firefox** attach via WebDriver BiDi (not CDP) — same snapshot/act contract once the adapter exists.

Docs must never imply fingerprint spoofing; "look normal" means *actually use* the user's browser.

## Snapshot contract

- Text lines with role, name, states, and `ref=eN`.
- Same serializer for managed and attached.
- Prefer token budget over completeness; MVP fixed defaults (no depth flags yet).

## Tech stack

- TypeScript / Node
- Playwright for managed Chromium + `connectOverCDP`
- `@modelcontextprotocol/sdk` for MCP
- MIT license

### Testing / CI notes

- Unit tests on serializer: required.
- Integration on **managed** Chromium: required for merge.
- Attach integration: optional smoke; **must not** block merge (flaky by nature).

## Error handling

- Stale ref → clear error asking for new `snapshot`
- Attach fail → actionable message (port, not Chromium, bind address, permission)
- Navigation fail → URL + status, no stack spam to the model

## Success criteria (MVP)

- Agent completes a multi-step public form flow using only snapshot+act (no screenshots).
- Same flow works after `attach` to local Chrome.
- README documents attach for a generic user PC (127.0.0.1 debugging).
- Token size of a typical snapshot is clearly smaller than a screenshot+vision path (measured on 2–3 sample pages).

## Later (explicitly out of v1)

- Firefox via WebDriver BiDi
- Persistent empty profile / proxy helpers
- `extract`, `screenshot`
- Hosted fleet
- README tip / thanks (post-ship only, if maintainer wants)

## Differentiation vs Playwright MCP

Worth building only if we keep: smaller tool surface, token-budgeted a11y serialization, MCP≡CLI parity, first-class attach to user Chromium, no SaaS lock-in. If we only re-expose the same CDP calls as Playwright MCP, abandon and contribute upstream instead.

## Appendix — example agent runtimes (non-normative)

Examples of runtimes that can reach a user CDP port include local Node on the same machine, CI with a headed Chrome, or desktop agent products with a local machine bridge. None of these brands are required to use Agent Smith Browser.
