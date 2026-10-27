import type { Page } from 'playwright';

/** Upper bound for screenshot `awaitPaint`. A quiet canvas still returns. */
export const PAINT_CAP_MS = 100;

/**
 * Wait until the largest canvas sample changes, or two animation frames when
 * the page has no canvas. Resolves false if the cap hits first.
 * The function passed to evaluate is self-contained so it can run in the page.
 */
export function waitForPaint(page: Page, capMs: number = PAINT_CAP_MS): Promise<boolean> {
  return page.evaluate(paintInPage, capMs);
}

function paintInPage(cap: number): Promise<boolean> {
  type El = {
    width: number;
    height: number;
    nodeType?: number;
    getContext: (kind: string) => {
      getImageData: (x: number, y: number, w: number, h: number) => { data: ArrayLike<number> };
      drawImage: (src: unknown, x: number, y: number, w: number, h: number) => void;
    } | null;
    toDataURL?: () => string;
  };
  const doc = (globalThis as { document?: { querySelectorAll: (s: string) => ArrayLike<El>; createElement: (t: string) => El } }).document;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (painted: boolean) => {
      if (settled) return;
      settled = true;
      resolve(painted);
    };
    const sample = (): string | null => {
      if (!doc) return null;
      const list = Array.from(doc.querySelectorAll('canvas'));
      if (!list.length) return null;
      let best = list[0];
      let area = -1;
      for (const c of list) {
        const next = c.width * c.height;
        if (next >= area) {
          best = c;
          area = next;
        }
      }
      const w = Math.min(32, best.width);
      const h = Math.min(32, best.height);
      if (w < 1 || h < 1) return 'empty';
      try {
        const ctx = best.getContext('2d');
        if (ctx) {
          const data = ctx.getImageData(0, 0, w, h).data;
          let hash = 0;
          for (let i = 0; i < data.length; i += 32) hash = (hash * 33 + data[i]) | 0;
          return `2d:${hash}`;
        }
      } catch {
        // Tainted canvas or a context that cannot be read. Fall through.
      }
      try {
        const off = doc.createElement('canvas');
        off.width = w;
        off.height = h;
        const octx = off.getContext('2d');
        if (!octx) return 'unreadable';
        octx.drawImage(best, 0, 0, w, h);
        return off.toDataURL ? off.toDataURL() : 'drawn';
      } catch {
        return 'unreadable';
      }
    };
    const initial = sample();
    const start = Date.now();
    let frames = 0;
    const tick = () => {
      frames += 1;
      if (initial == null && frames >= 2) return finish(true);
      const now = sample();
      if (initial != null && now != null && now !== initial && now !== 'unreadable') return finish(true);
      if (Date.now() - start >= cap) return finish(false);
      requestAnimationFrame(tick);
    };
    setTimeout(() => finish(false), cap + 30);
    requestAnimationFrame(tick);
  });
}
