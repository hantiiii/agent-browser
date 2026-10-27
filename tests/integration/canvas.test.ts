import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '../../src/session.js';
import type { HintMode, SnapshotResult } from '../../src/types.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function page(html: string): string {
  return `data:text/html,${encodeURIComponent(html)}`;
}

const A11Y_HTML = `<!doctype html><title>a11y</title>
<style>canvas { width: 40px; height: 40px; }</style>
<h1>Settings</h1>
<canvas width="40" height="40"></canvas>
<label>Name <input aria-label="Name"></label>
<button>Save</button>
<button>Cancel</button>
<a href="#docs">Docs</a>`;

const SPARSE_HTML = `<!doctype html><title>sparse</title><h1>Only a heading</h1>`;

const CANVAS_HTML = `<!doctype html><title>canvas</title>
<style>
  html, body { margin: 0; height: 100%; }
  canvas { position: fixed; inset: 0; width: 100vw; height: 100vh; display: block; }
</style>
<canvas width="8" height="8"></canvas>`;

const MIXED_HTML = `<!doctype html><title>mixed</title>
<style>
  html, body { margin: 0; height: 100%; }
  canvas.stage { position: fixed; left: 0; top: 0; width: 75vw; height: 100vh; }
  canvas.icon { position: fixed; left: 0; top: 0; width: 16px; height: 16px; }
  #chrome {
    position: fixed; top: 0; right: 0; width: 20vw; height: 100vh;
    display: flex; flex-direction: column; gap: 6px; padding: 8px; box-sizing: border-box;
  }
</style>
<canvas class="icon" width="16" height="16"></canvas>
<canvas class="stage" width="20" height="20"></canvas>
<div id="chrome">
  <button type="button">One</button>
  <button type="button">Two</button>
  <button type="button">Three</button>
  <a href="#four">Four</a>
</div>`;

const CLICK_HTML = `<!doctype html><title>click</title>
<style>html, body { margin: 0; }</style>
<p id="out">clicked none</p>
<button id="mark" style="position:fixed;right:8px;bottom:8px" onclick="this.textContent='Marked'">Mark</button>
<div style="height:3000px"></div>
<script>
document.addEventListener('click', function (e) {
  document.getElementById('out').textContent = 'clicked ' + e.clientX + ',' + e.clientY;
});
</script>`;

function hintLine(snap: SnapshotResult): { mode: HintMode; reasons: string[] } {
  const line = snap.text.split('\n').find((l) => l.startsWith('hints: '));
  if (!line) throw new Error(`no hints line in:\n${snap.text}`);
  return JSON.parse(line.slice('hints: '.length)) as { mode: HintMode; reasons: string[] };
}

describe('canvas hints, screenshot, and click_xy (managed, local pages)', () => {
  let session: Session;
  afterEach(async () => { await session?.close(); });

  it('classifies a11y, sparse, canvas, and mixed from the live page', async () => {
    session = new Session();
    const expectMode = async (html: string, mode: HintMode) => {
      await session.goto(page(html));
      const snap = await session.snapshot();
      const parsed = hintLine(snap);
      expect({ mode: snap.hints.mode, reasons: snap.hints.reasons, text: snap.text }).toMatchObject({ mode });
      expect(parsed).toEqual(snap.hints);
      expect(snap.hints.reasons.length).toBeGreaterThan(0);
      expect(snap.hints.reasons.join(' ')).not.toMatch(/auto-?switch|ocr|vision/i);
    };

    await expectMode(A11Y_HTML, 'a11y');
    await expectMode(SPARSE_HTML, 'sparse');
    await expectMode(CANVAS_HTML, 'canvas');
    await expectMode(MIXED_HTML, 'mixed');
  });

  it('screenshots the viewport and clicks css and normalized points', async () => {
    session = new Session();
    await session.goto(page(CLICK_HTML));

    const shot = await session.screenshot();
    expect(shot.bytes.subarray(0, 8).equals(PNG)).toBe(true);
    expect(shot.mimeType).toBe('image/png');
    expect(shot.fullPage).toBe(false);
    expect(shot.viewport.width).toBeGreaterThan(0);
    expect(shot.viewport.height).toBeGreaterThan(0);
    expect(shot.image).toEqual(shot.viewport);

    const full = await session.screenshot({ fullPage: true });
    expect(full.fullPage).toBe(true);
    expect(full.image.width).toBe(full.viewport.width);
    expect(full.image.height).toBeGreaterThan(full.viewport.height);
    expect(full.viewport).toEqual(shot.viewport);

    const hit = await session.clickXy({ x: 80, y: 60 });
    expect(hit).toMatchObject({ ok: true, x: 80, y: 60, space: 'css', viewport: shot.viewport });
    let snap = await session.snapshot();
    let coords = readClick(snap.text);
    expect(Math.abs(coords.x - 80)).toBeLessThan(1.5);
    expect(Math.abs(coords.y - 60)).toBeLessThan(1.5);

    const button = snap.nodes.find((n) => n.role === 'button' && n.name === 'Mark');
    expect(button?.ref).toBeTruthy();

    const norm = await session.clickXy({ x: 0.5, y: 0.25, space: 'normalized' });
    expect(Math.abs(norm.x - 0.5 * norm.viewport.width)).toBeLessThan(0.2);
    expect(Math.abs(norm.y - 0.25 * norm.viewport.height)).toBeLessThan(0.2);
    expect(norm.input).toEqual({ x: 0.5, y: 0.25 });
    // Same document: the ref from the earlier snapshot still works. click_xy does not require one.
    await session.act({ ref: button!.ref, kind: 'click' });
    snap = await session.snapshot();
    expect(snap.text).toContain('Marked');

    const again = await session.clickXy({ x: 0.5, y: 0.25, space: 'normalized' });
    snap = await session.snapshot();
    coords = readClick(snap.text);
    expect(Math.abs(coords.x - again.x)).toBeLessThan(1.5);
    expect(Math.abs(coords.y - again.y)).toBeLessThan(1.5);

    const edge = await session.clickXy({ x: 1, y: 1, space: 'normalized' });
    expect(edge.x).toBeGreaterThan(shot.viewport.width - 2);
    expect(edge.y).toBeGreaterThan(shot.viewport.height - 2);

    await expect(session.clickXy({ x: -5, y: 1 })).rejects.toThrow(
      new RegExp(`0\\.\\.${shot.viewport.width} x 0\\.\\.${shot.viewport.height}`),
    );
    await expect(session.clickXy({ x: 1.4, y: 0.2, space: 'normalized' })).rejects.toThrow(
      new RegExp(`${shot.viewport.width}x${shot.viewport.height}`),
    );
  });
});

function readClick(text: string): { x: number; y: number } {
  const match = text.match(/clicked ([0-9.]+),([0-9.]+)/);
  if (!match) throw new Error(`no click text in:\n${text}`);
  return { x: Number(match[1]), y: Number(match[2]) };
}
