import type { Page } from 'playwright';
import { AgentBrowserError } from './types.js';
import type { ViewportSize } from './types.js';

/** DOM controls that correspond to actionable a11y roles. Options inside a select are not counted twice. */
export const CONTROL_SELECTOR = [
  'button',
  'a[href]',
  'textarea',
  'select',
  'input:not([type="hidden"])',
  '[role="button"]',
  '[role="link"]',
  '[role="textbox"]',
  '[role="searchbox"]',
  '[role="combobox"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="menuitem"]',
  '[role="tab"]',
].join(', ');

export function visibleCoverage(
  rect: { left: number; top: number; right: number; bottom: number },
  viewport: ViewportSize,
): number {
  const { width: vw, height: vh } = viewport;
  if (!(vw > 0) || !(vh > 0)) return 0;
  const left = Math.max(rect.left, 0);
  const top = Math.max(rect.top, 0);
  const right = Math.min(rect.right, vw);
  const bottom = Math.min(rect.bottom, vh);
  const w = Math.max(0, right - left);
  const h = Math.max(0, bottom - top);
  return Math.round(((w * h) / (vw * vh)) * 10000) / 10000;
}

/** True when the rect's center lies outside the canvas border box. */
export function centerOutside(
  rect: { left: number; top: number; width: number; height: number },
  canvas: { x: number; y: number; width: number; height: number },
): boolean {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  return cx < canvas.x || cy < canvas.y || cx > canvas.x + canvas.width || cy > canvas.y + canvas.height;
}

export type CanvasGeometry = {
  viewport: ViewportSize;
  largestCoverage: number;
  actionableOutsideCanvas: number;
};

// Playwright evaluates a string as an expression. An IIFE runs in the page;
// a bare arrow function would serialize as a function and come back undefined.
const VIEWPORT_SCRIPT = '(() => ({ width: window.innerWidth, height: window.innerHeight }))()';

function geometryScript(): string {
  return `(() => {
    const visibleCoverage = ${visibleCoverage.toString()};
    const centerOutside = ${centerOutside.toString()};
    const selector = ${JSON.stringify(CONTROL_SELECTOR)};
    const width = window.innerWidth;
    const height = window.innerHeight;
    const viewport = { width: width, height: height };
    let largest = null;
    const canvases = document.querySelectorAll('canvas');
    for (let i = 0; i < canvases.length; i++) {
      const r = canvases[i].getBoundingClientRect();
      const coverage = visibleCoverage(
        { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
        viewport,
      );
      if (!(coverage > 0)) continue;
      if (!largest || coverage > largest.coverage) {
        largest = { x: r.x, y: r.y, width: r.width, height: r.height, coverage: coverage };
      }
    }
    let actionableOutsideCanvas = 0;
    if (largest) {
      const controls = document.querySelectorAll(selector);
      for (let i = 0; i < controls.length; i++) {
        const el = controls[i];
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        const style = window.getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none') continue;
        if (centerOutside({ left: r.left, top: r.top, width: r.width, height: r.height }, largest)) {
          actionableOutsideCanvas += 1;
        }
      }
    }
    return {
      viewport: { width: width, height: height },
      largestCoverage: largest ? largest.coverage : 0,
      actionableOutsideCanvas: actionableOutsideCanvas,
    };
  })()`;
}

function asSize(width: unknown, height: unknown): ViewportSize | null {
  if (typeof width !== 'number' || typeof height !== 'number') return null;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { width: Math.max(0, Math.round(width)), height: Math.max(0, Math.round(height)) };
}

/** CSS pixel viewport. innerWidth/innerHeight match mouse client coordinates. */
export async function readViewport(page: Page): Promise<ViewportSize> {
  const raw = await page.evaluate(VIEWPORT_SCRIPT) as { width?: unknown; height?: unknown };
  const size = asSize(raw?.width, raw?.height);
  if (size && size.width > 0 && size.height > 0) return size;
  const set = page.viewportSize();
  if (set && set.width > 0 && set.height > 0) {
    return { width: Math.round(set.width), height: Math.round(set.height) };
  }
  return size ?? { width: 0, height: 0 };
}

export async function readCanvasGeometry(page: Page): Promise<CanvasGeometry> {
  const raw = await page.evaluate(geometryScript()) as {
    viewport?: { width?: unknown; height?: unknown };
    largestCoverage?: unknown;
    actionableOutsideCanvas?: unknown;
  };
  const viewport = asSize(raw?.viewport?.width, raw?.viewport?.height);
  if (!viewport) throw new AgentBrowserError('canvas geometry missing viewport');
  if (typeof raw.largestCoverage !== 'number' || !Number.isFinite(raw.largestCoverage)) {
    throw new AgentBrowserError('canvas geometry missing coverage');
  }
  if (typeof raw.actionableOutsideCanvas !== 'number' || !Number.isFinite(raw.actionableOutsideCanvas)) {
    throw new AgentBrowserError('canvas geometry missing outside count');
  }
  return {
    viewport,
    largestCoverage: Math.min(1, Math.max(0, raw.largestCoverage)),
    actionableOutsideCanvas: Math.max(0, Math.round(raw.actionableOutsideCanvas)),
  };
}
