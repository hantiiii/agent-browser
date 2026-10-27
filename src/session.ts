import type { Locator, Page } from 'playwright';
import { AgentBrowserError } from './types.js';
import type { ActArgs, GotoResult, SessionMode, SnapshotNode, SnapshotResult } from './types.js';
import { serializeAxTree } from './a11y/serialize.js';
import { getAxTree, launchManaged as defaultLaunch } from './backends/managed.js';
import { connectAttach as defaultAttach } from './backends/attach.js';
import { resolveSettleMs } from './settle.js';
import type { Browser } from 'playwright';
import type { BrowserHandle } from './backends/managed.js';

export type SessionDeps = {
  launchManaged?: () => Promise<BrowserHandle>;
  connectAttach?: (cdpUrl: string) => Promise<{ browser: Browser; page: Page }>;
};

type Handle = { browser: Browser; page: Page };

export class Session {
  mode: SessionMode = 'idle';
  lastSnapshotNodes: SnapshotNode[] | null = null;
  private locators = new Map<string, Locator>();
  private handle: Handle | null = null;
  constructor(private deps: SessionDeps = {}) {}

  private invalidate() {
    this.lastSnapshotNodes = null;
    this.locators.clear();
  }

  private async ensurePage(): Promise<Page> {
    if (this.mode === 'idle' || !this.handle) {
      this.handle = await (this.deps.launchManaged ?? defaultLaunch)();
      this.mode = 'managed';
    }
    return this.handle.page;
  }

  async goto(url: string, opts?: { settleMs?: number }): Promise<GotoResult> {
    const settleMs = resolveSettleMs(opts?.settleMs);
    const page = await this.ensurePage();
    this.invalidate();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      if (settleMs > 0) await page.waitForTimeout(settleMs);
      return { ok: true, url: page.url() };
    } catch (e) {
      return { ok: false, error: (e as Error).message, url: page.url() };
    }
  }

  async snapshot(opts?: { settleMs?: number }): Promise<SnapshotResult> {
    const settleMs = resolveSettleMs(opts?.settleMs);
    const page = await this.ensurePage();
    if (settleMs > 0) await page.waitForTimeout(settleMs);
    const { text, nodes } = serializeAxTree(await getAxTree(page));
    this.invalidate();
    // ref -> locator via getByRole + nth for duplicate role/name pairs (MVP: may be ambiguous)
    const seen = new Map<string, number>();
    for (const n of nodes) {
      const key = `${n.role}\u0000${n.name}`;
      const idx = seen.get(key) ?? 0;
      seen.set(key, idx + 1);
      const loc = page.getByRole(n.role as Parameters<Page['getByRole']>[0], n.name ? { name: n.name, exact: true } : {});
      this.locators.set(n.ref, loc.nth(idx));
    }
    this.lastSnapshotNodes = nodes;
    return { text, nodes, url: page.url() };
  }

  async act(args: ActArgs): Promise<{ ok: true }> {
    // Never launch managed from act: refs only exist after a snapshot.
    if (this.mode === 'idle' || !this.lastSnapshotNodes || !this.handle) {
      throw new AgentBrowserError('snapshot first');
    }
    const loc = this.locators.get(args.ref);
    if (!loc) throw new AgentBrowserError(`stale or unknown ref ${args.ref}; snapshot first`);
    const page = this.handle.page;
    const urlBefore = page.url();
    try {
      if (args.kind === 'click') {
        await loc.click({ timeout: 10_000 }); // does not wait for navigation
      } else if (args.kind === 'type') {
        await loc.fill('', { timeout: 10_000 });
        await loc.fill(args.value ?? '', { timeout: 10_000 });
      } else if (args.kind === 'press') {
        if (!args.value) throw new AgentBrowserError('press requires value (Playwright key name, e.g. Enter)');
        await loc.press(args.value, { timeout: 10_000 });
      } else {
        throw new AgentBrowserError(`unknown act kind ${(args as ActArgs).kind}`);
      }
    } catch (e) {
      this.invalidate();
      if (e instanceof AgentBrowserError) throw e;
      throw new AgentBrowserError(`act failed on ${args.ref}: ${(e as Error).message}; snapshot first`);
    }
    if (page.url() !== urlBefore) this.invalidate();
    return { ok: true };
  }

  async attach(cdpUrl: string): Promise<{ ok: true; url: string }> {
    // Leave any current session first: managed is closed, a previous attach is only disconnected.
    await this.detach();
    try {
      this.handle = await (this.deps.connectAttach ?? defaultAttach)(cdpUrl);
    } catch (e) {
      this.handle = null;
      this.mode = 'idle';
      throw new AgentBrowserError(`attach failed: ${(e as Error).message}`);
    }
    this.mode = 'attached';
    this.invalidate();
    return { ok: true, url: this.handle.page.url() };
  }

  async detach(): Promise<{ ok: true }> {
    const h = this.handle;
    const mode = this.mode;
    this.handle = null;
    this.mode = 'idle';
    this.invalidate();
    if (h) await this.release(h, mode);
    return { ok: true };
  }

  /**
   * managed: we own the process -> close it.
   * attached: user's browser -> Playwright's browser.close() on a connectOverCDP browser
   * only disconnects (does not kill the user's process or their existing tabs).
   */
  private async release(h: Handle, _mode: SessionMode): Promise<void> {
    await h.browser.close().catch(() => {});
  }

  async close(): Promise<void> {
    await this.detach();
  }
}
