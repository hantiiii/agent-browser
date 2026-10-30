import type { Browser, BrowserContext, Locator, Page } from 'playwright';
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
import { assertNavigableUrl } from './url-policy.js';
import type { BrowserHandle } from './backends/managed.js';
import { installOpenHook } from './open-signal.js';
import { PAINT_CAP_MS, waitForPaint } from './paint.js';

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
  /** Pages whose current document already has the open hook. */
  private hookedPages = new WeakSet<Page>();
  private hookListeners = new WeakSet<Page>();
  private hookedContexts = new WeakSet<BrowserContext>();
  /** Incremented from the page when a gesture calls window.open or activates target=_blank. */
  private openSignals = 0;
  private observed: { page: Page; url: string } | null = null;
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
    const navigable = assertNavigableUrl(url);
    const settleMs = resolveSettleMs(opts?.settleMs);
    const page = await this.ensurePage();
    this.invalidate();
    try {
      await page.goto(navigable, { waitUntil: 'domcontentloaded' });
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
    // ref -> locator via getByRole + nth for duplicate role/name pairs (MVP: may be ambiguous).
    // Names are whitespace-normalized so a non-breaking space still matches the snapshot text.
    const seen = new Map<string, number>();
    for (const n of nodes) {
      const name = normalizeAccessibleName(n.name);
      const key = `${n.role}\u0000${name}`;
      const idx = seen.get(key) ?? 0;
      seen.set(key, idx + 1);
      const loc = page.getByRole(
        n.role as Parameters<Page['getByRole']>[0],
        name ? { name: accessibleNamePattern(name) } : {},
      );
      this.locators.set(n.ref, loc.nth(idx));
    }
    this.lastSnapshotNodes = nodes;
    const hints = await this.buildHints(page, text, nodes.length);
    const withHints = text ? `${text}\n\n${formatHints(hints)}` : formatHints(hints);
    return { text: withHints, nodes, url: page.url(), hints, pageChanged: this.markObservation(page) };
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
  async screenshot(opts?: { fullPage?: boolean; settleMs?: number; awaitPaint?: boolean }): Promise<ScreenshotResult> {
    const settleMs = resolveSettleMs(opts?.settleMs);
    const page = await this.ensurePage();
    if (settleMs > 0) await page.waitForTimeout(settleMs);
    const painted = opts?.awaitPaint ? await waitForPaint(page, PAINT_CAP_MS) : undefined;
    const fullPage = opts?.fullPage ?? false;
    const viewport = await readViewport(page);
    let bytes: Buffer;
    try {
      const shot = await page.screenshot({ type: 'png', fullPage, scale: 'css' });
      bytes = Buffer.from(shot);
    } catch (e) {
      throw new AgentBrowserError(`screenshot failed: ${(e as Error).message}`);
    }
    return {
      ok: true,
      bytes,
      mimeType: 'image/png',
      fullPage,
      viewport,
      image: readPngSize(bytes),
      url: page.url(),
      pageChanged: this.markObservation(page),
      ...(painted === undefined ? {} : { painted }),
    };
  }

  /**
   * Click a viewport point. Does not require a snapshot or a ref.
   * CSS pixels are the default. Normalized 0–1 values are scaled by the CSS viewport.
   * Returns when the click is delivered. It does not wait for paint.
   * Refs are cleared when the click changes the document URL or opens a new page.
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
      await this.runFollowingPopup(page, () => page.mouse.click(point.x, point.y));
    } catch (e) {
      if (e instanceof AgentBrowserError) throw e;
      throw new AgentBrowserError(`click_xy failed: ${(e as Error).message}`);
    }
    const current = this.handle?.page ?? page;
    if (current !== page || current.url() !== urlBefore) this.invalidate();
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
      await this.runFollowingPopup(page, async () => {
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
      });
    } catch (e) {
      this.invalidate();
      if (e instanceof AgentBrowserError) throw e;
      throw new AgentBrowserError(`act failed on ${args.ref}: ${(e as Error).message}; snapshot first`);
    }
    const current = this.handle.page;
    if (current !== page || current.url() !== urlBefore) this.invalidate();
    return { ok: true };
  }

  /**
   * Follow a popup or new page created by this action in the same browser context.
   * Tabs that were already open stay put. There is still one active page afterward.
   * A click that does not open a window returns with the click. The short cap runs
   * only after the page reports window.open or a target=_blank activation.
   */
  private async runFollowingPopup(page: Page, action: () => Promise<void>): Promise<void> {
    await this.ensureOpenHook(page);
    const context = page.context();
    const before = new Set(context.pages());
    const signalsBefore = this.openSignals;
    let newest: Page | undefined;
    let resolveWait: (() => void) | undefined;
    const note = (next: Page) => {
      if (before.has(next)) return;
      newest = next;
      resolveWait?.();
    };
    context.on('page', note);
    page.on('popup', note);
    try {
      await action();
      const inFlight = this.openSignals !== signalsBefore;
      if (!openedPage(context, before, newest) && inFlight) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, POPUP_FOLLOW_CAP_MS);
          resolveWait = () => {
            clearTimeout(timer);
            resolve();
          };
          if (openedPage(context, before, newest)) resolveWait();
        });
      }
    } finally {
      context.off('page', note);
      page.off('popup', note);
      resolveWait = undefined;
    }
    await this.adoptOpenedPage(context, before, newest);
  }

  private async ensureOpenHook(page: Page): Promise<void> {
    const context = page.context();
    if (!this.hookedContexts.has(context)) {
      await context.exposeBinding('__asbNotifyOpen', () => {
        this.openSignals += 1;
      });
      await context.addInitScript(installOpenHook);
      this.hookedContexts.add(context);
    }
    if (!this.hookListeners.has(page)) {
      this.hookListeners.add(page);
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) this.hookedPages.delete(page);
      });
    }
    if (this.hookedPages.has(page)) return;
    await page.evaluate(installOpenHook);
    this.hookedPages.add(page);
  }

  /** True when this page or its URL differs from the previous snapshot or screenshot. */
  private markObservation(page: Page): boolean {
    const url = page.url();
    const prev = this.observed;
    const pageChanged = prev !== null && (prev.page !== page || prev.url !== url);
    this.observed = { page, url };
    return pageChanged;
  }

  private async adoptOpenedPage(context: BrowserContext, before: Set<Page>, newest: Page | undefined): Promise<void> {
    const next = openedPage(context, before, newest);
    if (!next || !this.handle || next === this.handle.page) return;
    this.handle.page = next;
    this.invalidate();
    await next.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => {});
    await next.bringToFront().catch(() => {});
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
    this.observed = null;
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

/**
 * Backstop after the page has already reported an open. Headless window.open
 * lands in a few milliseconds; target=_blank a little later. No-popup clicks do not wait.
 */
const POPUP_FOLLOW_CAP_MS = 80;

function openedPage(context: BrowserContext, before: Set<Page>, newest: Page | undefined): Page | undefined {
  if (newest && !newest.isClosed()) return newest;
  return context.pages().filter((p) => !before.has(p) && !p.isClosed()).at(-1);
}

function normalizeAccessibleName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

/** Whole-string match where any whitespace run, including NBSP, separates the same words. */
function accessibleNamePattern(name: string): RegExp {
  const parts = normalizeAccessibleName(name).split(' ').filter(Boolean).map(escapeRegExp);
  return new RegExp(`^\\s*${parts.join('\\s+')}\\s*$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
