import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '../../src/session.js';

const changing = `<!doctype html><title>paint</title>
<style>html, body { margin: 0; }</style>
<canvas id="c" width="40" height="40"></canvas>
<script>
  const ctx = document.getElementById('c').getContext('2d');
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, 40, 40);
  document.addEventListener('click', () => {
    setTimeout(() => {
      ctx.fillStyle = '#eee';
      ctx.fillRect(0, 0, 40, 40);
    }, 30);
  });
</script>`;

const still = `<!doctype html><title>still</title>
<canvas id="c" width="40" height="40"></canvas>
<script>
  const ctx = document.getElementById('c').getContext('2d');
  ctx.fillStyle = '#222';
  ctx.fillRect(0, 0, 40, 40);
</script>`;

const noCanvas = `<!doctype html><title>plain</title><p>hello</p>`;

function page(html: string): string {
  return `data:text/html,${encodeURIComponent(html)}`;
}

describe('screenshot awaitPaint', () => {
  let session: Session;
  afterEach(async () => { await session?.close(); });

  it('returns when the canvas sample changes and does not hang', async () => {
    session = new Session();
    await session.goto(page(changing));
    await session.clickXy({ x: 8, y: 8 });
    const started = performance.now();
    const shot = await session.screenshot({ awaitPaint: true });
    const elapsed = performance.now() - started;
    expect(shot.painted).toBe(true);
    expect(shot.bytes.length).toBeGreaterThan(8);
    expect(shot.pageChanged).toBe(false);
    expect(elapsed).toBeGreaterThan(15);
    expect(elapsed).toBeLessThan(180);
  });

  it('returns the current shot when the canvas does not change within the cap', async () => {
    session = new Session();
    await session.goto(page(still));
    const started = performance.now();
    const shot = await session.screenshot({ awaitPaint: true });
    const elapsed = performance.now() - started;
    expect(shot.painted).toBe(false);
    expect(shot.bytes.length).toBeGreaterThan(8);
    expect(shot.url).toContain('data:text/html');
    expect(elapsed).toBeGreaterThan(70);
    expect(elapsed).toBeLessThan(200);
  });

  it('uses two frames when the page has no canvas', async () => {
    session = new Session();
    await session.goto(page(noCanvas));
    const started = performance.now();
    const shot = await session.screenshot({ awaitPaint: true });
    const elapsed = performance.now() - started;
    expect(shot.painted).toBe(true);
    expect(elapsed).toBeLessThan(80);
  });

  it('omits painted when awaitPaint is not set', async () => {
    session = new Session();
    await session.goto(page(noCanvas));
    const shot = await session.screenshot();
    expect(shot.painted).toBeUndefined();
    expect(shot.pageChanged).toBe(false);
  });
});
