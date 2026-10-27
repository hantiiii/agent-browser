# Agent Browser MVP Implementation Plan

> **Current name:** Agent Smith Browser (ASB). npm and GitHub are `agent-smith-browser`. CLI binaries are `asb` and `agent-browser` (same entry, `bin/agent-browser.js`). This file is the original MVP record and still says `agent-browser` where that was the only command name.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an MIT TypeScript package that gives agents `goto` / `snapshot` / `act` / `attach` / `detach` over a thin Playwright Chromium core, exposed as MCP + CLI, with optional attach to the user's real Chrome/Edge.

**Architecture:** One `Session` owns mode (`idle` | `managed` | `attached`) and a ref table. Playwright drives managed Chromium or `connectOverCDP`. A shared a11y serializer emits budgeted text + `eN` refs. MCP and CLI are thin adapters over the same `Session` methods.

**Tech Stack:** Node 20+, TypeScript 5, Playwright, `@modelcontextprotocol/sdk`, Vitest, npm package name `agent-smith-browser` (CLI binaries `asb` and `agent-browser`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-27-agent-browser-design.md` (HEAD) — follow it over this plan if they diverge.
- MVP tools only: goto, snapshot, act, attach, detach.
- `goto` wait = `domcontentloaded` only (never networkidle).
- `type` = clear-then-fill (replace). `press` = Playwright key names. `click` does not wait for navigation.
- Attach = Chrome/Edge via `chromium.connectOverCDP`; docs bind `127.0.0.1`; Firefox out of MVP.
- No fingerprint spoofing, captcha solvers, screenshots, extract, or SaaS.
- Idle + `act` without prior snapshot → error "snapshot first" (do not launch managed).
- Managed Chromium integration tests required for merge; attach CI optional smoke.
- MIT license; no product branding hard-requirements in README.

## Browser Core plan review (accepted 2026-10-27)

- **FIX (serializer):** allocate `eN` refs **only** for actionable/interactive nodes. Headings/text/images may appear in the text tree **without** a ref and **must not** consume the `eN` counter (no holes like e1→e3).
- **FIX (Task 4 AX source):** do **not** hardcode deprecated `page.accessibility.snapshot()` blindly. In Task 4 pick the current Playwright/CDP Accessibility API that still yields a tree compatible with `serializeAxTree`.
- **CUT (CLI):** no CLI daemon and no REPL. Lock: long-lived path = `mcp`; CLI = one-shot commands + `demo` only.
- **NOTE:** `getByRole` + nth for duplicate role/name is OK for MVP; README must state the limit in one line (identical name/role).

## File map

```
package.json
tsconfig.json
vitest.config.ts
src/index.ts                 # public exports
src/types.ts                 # ActKind, SnapshotResult, SessionMode, …
src/session.ts               # Session state machine + tool methods
src/a11y/serialize.ts        # accessibility snapshot → text + ref map
src/backends/managed.ts      # launch/close Playwright chromium
src/backends/attach.ts       # connectOverCDP / disconnect
src/mcp/server.ts            # MCP stdio server
src/cli.ts                   # CLI entry
bin/agent-browser.js         # bin shim
tests/a11y/serialize.test.ts
tests/session/state.test.ts
tests/session/act.test.ts
tests/integration/managed.test.ts
README.md
LICENSE
```

---

### Task 1: Scaffold package

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `LICENSE`, `src/index.ts`, `src/types.ts`

**Interfaces:**
- Produces: npm scripts `build`, `test`, `test:integration`; types `ActKind`, `SessionMode`, `ActArgs`, `GotoResult`, `SnapshotResult`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "agent-browser",
  "version": "0.1.0",
  "description": "Thin a11y+refs browser for AI agents (MCP + CLI)",
  "type": "module",
  "license": "MIT",
  "bin": { "agent-browser": "./bin/agent-browser.js" },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "vitest run tests/integration",
    "mcp": "node dist/mcp/server.js",
    "cli": "node dist/cli.js"
  },
  "engines": { "node": ">=20" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "playwright": "^1.49.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json` and `vitest.config.ts`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
```

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], testTimeout: 60_000 },
});
```

- [ ] **Step 3: Create `src/types.ts`**

```ts
export type SessionMode = 'idle' | 'managed' | 'attached';
export type ActKind = 'click' | 'type' | 'press';

export type ActArgs = {
  ref: string;
  kind: ActKind;
  value?: string;
};

export type GotoResult = { ok: true; url: string } | { ok: false; error: string; url?: string };

export type SnapshotNode = {
  ref: string;
  role: string;
  name: string;
  states?: string[];
};

export type SnapshotResult = {
  text: string;
  nodes: SnapshotNode[];
  url: string;
};

export class AgentBrowserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentBrowserError';
  }
}
```

- [ ] **Step 4: Create stub `src/index.ts` and MIT `LICENSE`**

```ts
export * from './types.js';
```

- [ ] **Step 5: Install and verify**

Run: `cd /workspace/agent-browser && npm install && npx tsc -p tsconfig.json --noEmit`
Expected: exit 0 after types compile (index may be empty of session yet).

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts LICENSE src/types.ts src/index.ts package-lock.json
git commit -m "chore: scaffold agent-browser package"
```

---

### Task 2: A11y serializer

**Files:**
- Create: `src/a11y/serialize.ts`
- Test: `tests/a11y/serialize.test.ts`

**Interfaces:**
- Consumes: Playwright-like AX node shape `{ role, name, value?, checked?, disabled?, children? }`
- Produces: `serializeAxTree(root, opts?) => { text: string; refByBackendId: Map<string, string>; nodes: SnapshotNode[] }` assigning `e1`, `e2`, …

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { serializeAxTree } from '../../src/a11y/serialize.js';

describe('serializeAxTree', () => {
  it('assigns eN refs to interactive nodes and drops empty generics', () => {
    const root = {
      role: 'RootWebArea',
      name: '',
      children: [
        { role: 'heading', name: 'Login', children: [] },
        { role: 'textbox', name: 'Email', children: [] },
        { role: 'button', name: 'Sign In', children: [] },
        { role: 'generic', name: '', children: [] },
      ],
    };
    const { text, nodes } = serializeAxTree(root);
    expect(text).toContain('heading "Login"');
    expect(text).not.toMatch(/heading "Login".*\[ref=/);
    expect(text).toMatch(/textbox "Email" \[ref=e1\]/);
    expect(text).toMatch(/button "Sign In" \[ref=e2\]/);
    expect(text).not.toMatch(/generic/);
    expect(nodes.map((n) => n.ref)).toEqual(['e1', 'e2']);
  });

  it('does not consume eN for non-actionable nodes (no holes)', () => {
    const root = {
      role: 'RootWebArea',
      name: '',
      children: [
        { role: 'heading', name: 'A', children: [] },
        { role: 'heading', name: 'B', children: [] },
        { role: 'button', name: 'Go', children: [] },
      ],
    };
    const { text, nodes } = serializeAxTree(root);
    expect(text).toContain('heading "A"');
    expect(text).toContain('heading "B"');
    expect(nodes.map((n) => n.ref)).toEqual(['e1']);
    expect(text).toMatch(/button "Go" \[ref=e1\]/);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npx vitest run tests/a11y/serialize.test.ts`
Expected: FAIL module not found / serializeAxTree undefined

- [ ] **Step 3: Implement `src/a11y/serialize.ts`**

```ts
import type { SnapshotNode } from '../types.js';

export type AxNode = {
  role?: string;
  name?: string;
  value?: string;
  checked?: boolean | 'mixed';
  disabled?: boolean;
  focused?: boolean;
  children?: AxNode[];
  backendDOMNodeId?: number;
};

const INTERACTIVE = new Set([
  'button', 'link', 'textbox', 'searchbox', 'combobox', 'listbox', 'option',
  'checkbox', 'radio', 'switch', 'slider', 'spinbutton', 'menuitem', 'tab',
]);

function isInteresting(n: AxNode): boolean {
  const role = (n.role || '').toLowerCase();
  const name = (n.name || '').trim();
  if (INTERACTIVE.has(role)) return true;
  if (['heading', 'text', 'image'].includes(role) && name) return true;
  return false;
}

export function serializeAxTree(root: AxNode): { text: string; nodes: SnapshotNode[] } {
  const nodes: SnapshotNode[] = [];
  const lines: string[] = [];
  let i = 0;

  const walk = (n: AxNode, depth: number) => {
    if (isInteresting(n)) {
      const role = (n.role || 'generic').toLowerCase();
      const name = (n.name || '').replace(/\s+/g, ' ').trim();
      const states: string[] = [];
      if (n.disabled) states.push('disabled');
      if (n.checked === true) states.push('checked');
      if (n.checked === 'mixed') states.push('mixed');
      if (n.focused) states.push('focused');
      const stateStr = states.length ? ` (${states.join(', ')})` : '';
      // BC FIX: eN only for actionable; headings/text never consume the counter
      let refStr = '';
      if (INTERACTIVE.has(role)) {
        i += 1;
        const ref = `e${i}`;
        refStr = ` [ref=${ref}]`;
        nodes.push({ ref, role, name, states: states.length ? states : undefined });
      }
      lines.push(`${'  '.repeat(depth)}${role}${name ? ` "${name}"` : ''}${stateStr}${refStr}`);
    }
    for (const c of n.children || []) walk(c, depth + (isInteresting(n) ? 1 : 0));
  };

  walk(root, 0);
  return { text: lines.join('\n'), nodes };
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npx vitest run tests/a11y/serialize.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/a11y/serialize.ts tests/a11y/serialize.test.ts
git commit -m "feat: a11y tree serializer with eN refs"
```

---

### Task 3: Session state machine (unit, no browser)

**Files:**
- Create: `src/session.ts` (skeleton), `tests/session/state.test.ts`

**Interfaces:**
- Produces: `class Session { mode; async goto; async snapshot; async act; async attach; async detach; async close }`
- For this task: only mode transitions with injectable fake backend.

- [ ] **Step 1: Write failing tests for mode rules**

```ts
import { describe, it, expect } from 'vitest';
import { Session } from '../../src/session.js';
import { AgentBrowserError } from '../../src/types.js';

describe('Session mode', () => {
  it('act in idle without snapshot throws snapshot first', async () => {
    const s = new Session({ launchManaged: async () => { throw new Error('should not launch'); } });
    await expect(s.act({ ref: 'e1', kind: 'click' })).rejects.toThrow(/snapshot first/i);
  });

  it('detach from idle is no-op ok', async () => {
    const s = new Session();
    await expect(s.detach()).resolves.toMatchObject({ ok: true });
    expect(s.mode).toBe('idle');
  });
});
```

- [ ] **Step 2: Implement minimal `Session` with deps injection**

Implement enough of `src/session.ts` so the above tests pass: track `mode`, `lastSnapshotNodes`, refuse `act` when no snapshot / idle without snapshot, `detach` from idle returns `{ ok: true }`. Stub `goto`/`snapshot`/`attach` to throw `not implemented` for now if called.

- [ ] **Step 3: Run tests PASS + commit**

```bash
npx vitest run tests/session/state.test.ts
git add src/session.ts tests/session/state.test.ts
git commit -m "feat: session idle rules (act requires snapshot)"
```

---

### Task 4: Managed backend + goto/snapshot/act

**Files:**
- Create: `src/backends/managed.ts`
- Modify: `src/session.ts`
- Test: `tests/session/act.test.ts`, `tests/integration/managed.test.ts`

**Interfaces:**
- `launchManaged(): Promise<{ browser, context, page }>`
- `Session.goto(url)` waits `domcontentloaded`
- `Session.snapshot()` fetches an AX tree via the **current** Playwright/CDP Accessibility API (do **not** hardcode deprecated `page.accessibility.snapshot()`; verify against installed Playwright docs), then `serializeAxTree`
- `Session.act` resolves ref → role/name from last snapshot nodes; uses getByRole/getByLabel heuristics or stored selectors map from serialize (prefer mapping ref → locator built at snapshot time)

**Locator strategy (lock in):** When serializing from Playwright AX, also build `Map<ref, Locator>` by walking with `page.getByRole(role, { name })` nth-match for duplicates. Store locators on Session until invalidation. **MVP limit (README one-liner):** identical role+name pairs rely on nth; may be ambiguous.

- [ ] **Step 1: Unit test act replace-type semantics with mock page** (optional if hard — prefer integration)

- [ ] **Step 2: Integration test (required)**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { Session } from '../../src/session.js';

describe('managed integration', () => {
  let session: Session;
  afterEach(async () => { await session?.close(); });

  it('goto + snapshot + click on example.com', async () => {
    session = new Session();
    const g = await session.goto('https://example.com');
    expect(g.ok).toBe(true);
    const snap = await session.snapshot();
    expect(snap.text.toLowerCase()).toMatch(/example|more information|domain/);
    expect(session.mode).toBe('managed');
  });
});
```

- [ ] **Step 3: Implement managed launch + session methods**

`goto`: if idle, launch managed → managed; `page.goto(url, { waitUntil: 'domcontentloaded' })`; clear refs.

`snapshot`: ensure page (launch on snapshot allowed); ax snapshot; serialize; store ref→locator map; return text.

`act`: require snapshot; locate; click / fill('')+fill(value) / press(value); on navigation clear refs.

`close`: close managed browser if any.

- [ ] **Step 4: Run**

Run: `npx vitest run tests/integration/managed.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/backends/managed.ts src/session.ts tests/integration/managed.test.ts tests/session/act.test.ts
git commit -m "feat: managed Chromium goto/snapshot/act"
```

---

### Task 5: Attach / detach via connectOverCDP

**Files:**
- Create: `src/backends/attach.ts`
- Modify: `src/session.ts`
- Test: manual smoke doc; optional `tests/integration/attach.test.ts` skipped by default

**Interfaces:**
- `attach(cdpUrl: string)` closes managed if open; `chromium.connectOverCDP(cdpUrl)`; pick existing context/page or new page; mode=attached; clear refs
- `detach()` disconnects without closing user browser; mode=idle; clear refs
- Accept `http://127.0.0.1:9222` and `ws://…`

- [ ] **Step 1: Implement attach backend**

```ts
import { chromium, type Browser, type Page } from 'playwright';

export async function connectAttach(cdpUrl: string): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0] ?? await browser.newContext();
  const page = context.pages()[0] ?? await context.newPage();
  return { browser, page };
}
```

- [ ] **Step 2: Wire Session.attach/detach** (attach kills managed first)

- [ ] **Step 3: Document smoke in README** (Task 7) — CI: `describe.skip` or `ATTACH_CDP_URL` env gate

- [ ] **Step 4: Commit**

```bash
git add src/backends/attach.ts src/session.ts
git commit -m "feat: attach/detach via connectOverCDP"
```

---

### Task 6: MCP server

**Files:**
- Create: `src/mcp/server.ts`

**Interfaces:**
- Tools named `goto`, `snapshot`, `act`, `attach`, `detach` matching spec JSON schemas
- One process-wide `Session` instance

- [ ] **Step 1: Implement stdio MCP server with @modelcontextprotocol/sdk**

Register tools; map errors to text content; never return stacks.

- [ ] **Step 2: Manual smoke**

Run: `npx tsc && node dist/mcp/server.js` (stdio — expect idle listen; kill with Ctrl+C)

- [ ] **Step 3: Commit**

```bash
git add src/mcp/server.ts
git commit -m "feat: MCP server for agent-browser tools"
```

---

### Task 7: CLI + README

**Files:**
- Create: `src/cli.ts`, `bin/agent-browser.js`, `README.md`
- Modify: `src/index.ts` export Session

**CLI shape:**

```bash
agent-browser goto https://example.com
agent-browser snapshot
agent-browser act e1 click
agent-browser act e2 type "hello"
agent-browser act e3 press Enter
agent-browser attach http://127.0.0.1:9222
agent-browser detach
```

**CUT (BC):** no CLI daemon, no `--repl`, no session file. Long-lived multi-step = MCP only.

**Lock:** each CLI invocation is one-shot (start/stop managed for that command). **MVP CLI:** 

```
agent-browser mcp    # run MCP stdio
agent-browser demo   # goto example.com + print snapshot (smoke)
```

Plus thin wrappers that create Session, run one tool, print JSON, close.

- [ ] **Step 1: Implement `src/cli.ts`** with commands: `mcp`, `goto`, `snapshot`, `act`, `attach`, `detach`, `demo` — **no** daemon/REPL

For multi-step CLI without daemon: write `.agent-browser-state` is out of scope — print guidance to use MCP for multi-step.

- [ ] **Step 2: README** — install, MCP config snippet, attach Chrome with `--remote-debugging-address=127.0.0.1 --remote-debugging-port=9222`, trust warning, non-goals, Firefox later; one line on getByRole+nth limit for identical role/name

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts bin/agent-browser.js README.md src/index.ts
git commit -m "feat: CLI and README"
```

---

### Task 8: Export polish + plan note for GitHub

**Files:**
- Modify: `package.json` files field, `.gitignore`

```
node_modules/
dist/
.playwright/
*.log
```

- [ ] **Step 1: `npm test && npm run test:integration && npm run build`**
Expected: all required tests PASS

- [ ] **Step 2: Commit ignore + any fixes**

- [ ] **Step 3: When GitHub connected:** create public repo under Łukasz's account, push `main`, do not force

---

## Spec coverage checklist

| Spec item | Task |
|-----------|------|
| goto/snapshot/act | 4 |
| attach/detach + connectOverCDP | 5 |
| MCP + CLI | 6–7 |
| a11y refs + budget | 2 |
| session idle/managed/attached | 3–5 |
| domcontentloaded | 4 |
| type replace, press keys, click no nav wait | 4 |
| Chrome/Edge only attach | 5 + README |
| no spoof / no screenshot | enforced by omission |
| managed CI required | 4 |
| attach CI optional | 5 |

## Optimization pass (done in this plan)

- Stateless CLI for MVP (MCP is long-lived) — **no** daemon/REPL (BC CUT).
- Locator map at snapshot time — avoids fragile CSS.
- Serializer unit-tested without browser — fast feedback.
- Attach skipped in CI by default — green merges.
