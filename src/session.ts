import type { Locator, Page } from 'playwright';
import { AgentBrowserError } from './types.js';
import type {
  ActArgs,
  ClickSpace,
  ClickXyArgs,
  ClickXyResult,
  GotoResult,
  ScreenshotResult,
  SessionMode,
  SnapshotHints,
  SnapshotNode,
  SnapshotResult,
} from './types.js';
import { serializeAxTree } from './a11y/serialize.js';
import { getAxTree, launchManaged as defaultLaunch } from './backends/managed.js';
import { connectAttach as defaultAttach } from './backends/attach.js';
import { readCanvasGeometry, readViewport } from './geometry.js';
import { classifySnapshotHints, countSnapshotLines, formatHints } from './hints.js';
import { readPngSize } from './png.js';
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
    const hints = await this.buildHints(page, text, nodes.length);
    const withHints = text ? `${text}\n\n${formatHints(hints)}` : formatHints(hints);
    return { text: withHints, nodes, url: page.url(), hints };
  }

  /**
   * Hints are advisory. A geometry failure still returns a tree-only mode plus a reason.
   * Nothing here calls screenshot or click_xy.
   */
  private async buildHints(page: Page, body: string, actionable: number): Promise<SnapshotHints> {
    const total = countSnapshotLines(body);
    let largestCoverage = 0;
    let actionableOutsideCanvas = 0;
    let note: string | undefined;
    try {
      const geometry = await readCanvasGeometry(page);
      largestCoverage = geometry.largestCoverage;
      actionableOutsideCanvas = geometry.actionableOutsideCanvas;
    } catch (e) {
      const raw = e instanceof Error ? e.message.split('\n')[0] : String(e);
      note = `canvas metrics unavailable (${raw.slice(0, 180)})`;
    }
    const hints = classifySnapshotHints({
      actionable,
      total,
      largestCoverage,
      actionableOutsideCanvas,
    });
    if (!note) return hints;
    return { mode: hints.mode, reasons: [...hints.reasons, note] };
  }

  /**
   * Viewport PNG by default (one image pixel per CSS pixel). fullPage is the scrollable page
   * and is not a click_xy coordinate map. Does not invalidate refs.
   */
  async screenshot(opts?: { fullPage?: boolean; settleMs?: number }): Promise<ScreenshotResult> {
    const settleMs = resolveSettleMs(opts?.settleMs);
    const page = await this.ensurePage();
    if (settleMs > 0) await page.waitForTimeout(settleMs);
    const fullPage = opts?.fullPage ?? false;
    const viewport = await readViewport(page);
    let bytes: Buffer;
    try {
      const shot = await page.screenshot({ type: 'png', fullPage, scale: 'css' });
      bytes = Buffer.from(shot);
    } catch (e) {
      throw new AgentBrowserError(`screenshot failed: ${(e as Error).message}`);
    }
    return { ok: true, bytes, mimeType: 'image/png', fullPage, viewport, image: readPngSize(bytes) };
  }

  /**
   * Click a viewport point. Does not require a snapshot or a ref.
   * CSS pixels are the default. Normalized 0–1 values are scaled by the CSS viewport.
   * Refs are cleared only when the click changes the document URL.
   */
  async clickXy(args: ClickXyArgs, opts?: { settleMs?: number }): Promise<ClickXyResult> {
    const settleMs = resolveSettleMs(opts?.settleMs);
    const page = await this.ensurePage();
    if (settleMs > 0) await page.waitForTimeout(settleMs);
    const viewport = await readViewport(page);
    if (viewport.width <= 0 || viewport.height <= 0) {
      throw new AgentBrowserError(`viewport is ${viewport.width}x${viewport.height}; cannot map click_xy`);
    }
    const space = resolveClickSpace(args.space);
    if (!Number.isFinite(args.x) || !Number.isFinite(args.y)) {
      throw new AgentBrowserError(
        `click_xy x and y must be finite numbers; viewport is ${viewport.width}x${viewport.height}`,
      );
    }
    const point = mapClick(space, args.x, args.y, viewport.width, viewport.height);
    const urlBefore = page.url();
    try {
      await page.mouse.click(point.x, point.y);
    } catch (e) {
      if (e instanceof AgentBrowserError) throw e;
      throw new AgentBrowserError(`click_xy failed: ${(e as Error).message}`);
    }
    if (page.url() !== urlBefore) this.invalidate();
    return { ok: true, x: point.x, y: point.y, space, input: { x: args.x, y: args.y }, viewport };
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

function resolveClickSpace(space: ClickSpace | undefined): ClickSpace {
  if (space == null || space === 'css') return 'css';
  if (space === 'normalized') return 'normalized';
  throw new AgentBrowserError(`unknown click space ${String(space)}; use css or normalized`);
}

function roundPx(n: number): number {
  return Math.round(n * 100) / 100;
}

function mapClick(
  space: ClickSpace,
  x: number,
  y: number,
  width: number,
  height: number,
): { x: number; y: number } {
  if (space === 'normalized') {
    if (x < 0 || x > 1 || y < 0 || y > 1) {
      throw new AgentBrowserError(
        `normalized x and y must be between 0 and 1; viewport is ${width}x${height} css px`,
      );
    }
    return { x: roundPx(x * width), y: roundPx(y * height) };
  }
  if (x < 0 || y < 0 || x > width || y > height) {
    throw new AgentBrowserError(
      `css x,y must lie inside the viewport 0..${width} x 0..${height}; got ${x},${y}`,
    );
  }
  return { x, y };
}
