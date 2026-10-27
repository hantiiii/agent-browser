import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '../../src/session.js';

async function serve(pages: Record<string, string>): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const body = pages[path] ?? pages['/'] ?? 'missing';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('test server has no port');
  return {
    origin: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

const opener = `<!doctype html><title>opener</title>
<button id="go">Open lobby</button>
<script>
  document.getElementById('go').addEventListener('click', () => {
    window.open('/lobby', 'game');
  });
</script>`;

const lobby = `<!doctype html><title>lobby</title>
<button>Seat</button>
<p>lobby-marker</p>`;

describe('popup follow', () => {
  let session: Session;
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await session?.close();
    await close?.();
    close = undefined;
  });

  it('act click that opens a window switches the active page to it', async () => {
    const site = await serve({ '/': opener, '/lobby': lobby });
    close = site.close;
    session = new Session();
    await session.goto(`${site.origin}/`);
    const snap = await session.snapshot();
    expect(snap.pageChanged).toBe(false);
    const btn = snap.nodes.find((n) => n.role === 'button' && n.name === 'Open lobby');
    expect(btn).toBeTruthy();
    await session.act({ ref: btn!.ref, kind: 'click' });
    await expect(session.act({ ref: btn!.ref, kind: 'click' })).rejects.toThrow(/snapshot first/i);
    const after = await session.snapshot();
    expect(after.pageChanged).toBe(true);
    expect(after.url).toContain('/lobby');
    expect(after.text).toContain('lobby-marker');
    expect(after.nodes.some((n) => n.role === 'button' && n.name === 'Seat')).toBe(true);
  });

  it('act follows a same-url popup, which is a different page', async () => {
    const same = `<!doctype html><title>room</title>
<button id="go">Enter</button>
<p id="which">marketing</p>
<script>
  if (window.name === 'game') {
    document.body.innerHTML = '<button>Seat</button><p>lobby-marker</p>';
  } else {
    document.getElementById('go').addEventListener('click', () => {
      window.open(location.href, 'game');
    });
  }
</script>`;
    const site = await serve({ '/': same });
    close = site.close;
    session = new Session();
    await session.goto(`${site.origin}/`);
    const snap = await session.snapshot();
    expect(snap.text).toContain('marketing');
    const btn = snap.nodes.find((n) => n.role === 'button' && n.name === 'Enter');
    expect(btn).toBeTruthy();
    await session.act({ ref: btn!.ref, kind: 'click' });
    const after = await session.snapshot();
    expect(new URL(after.url).pathname).toBe('/');
    expect(after.text).toContain('lobby-marker');
    expect(after.text).not.toContain('marketing');
  });

  it('click_xy that opens a window switches the active page to it', async () => {
    const fullscreen = opener.replace(
      '<button id="go">Open lobby</button>',
      '<button id="go" style="position:fixed;inset:0">Open lobby</button>',
    );
    const site = await serve({ '/': fullscreen, '/lobby': lobby });
    close = site.close;
    session = new Session();
    await session.goto(`${site.origin}/`);
    const snap = await session.snapshot();
    const btn = snap.nodes.find((n) => n.role === 'button' && n.name === 'Open lobby');
    expect(btn).toBeTruthy();
    await session.clickXy({ x: 20, y: 20 });
    await expect(session.act({ ref: btn!.ref, kind: 'click' })).rejects.toThrow(/snapshot first/i);
    const after = await session.snapshot();
    expect(after.pageChanged).toBe(true);
    expect(after.url).toContain('/lobby');
    expect(after.text).toContain('lobby-marker');
    const again = await session.snapshot();
    expect(again.pageChanged).toBe(false);
  });

  it('click_xy on a target=_blank link follows that page', async () => {
    const blank = `<!doctype html><title>opener</title>
<a href="/lobby" target="_blank" style="position:fixed;inset:0;display:block">Open lobby</a>`;
    const site = await serve({ '/': blank, '/lobby': lobby });
    close = site.close;
    session = new Session();
    await session.goto(`${site.origin}/`);
    await session.snapshot();
    await session.clickXy({ x: 30, y: 30 });
    const after = await session.snapshot();
    expect(after.pageChanged).toBe(true);
    expect(after.url).toContain('/lobby');
    expect(after.text).toContain('lobby-marker');
  });

  it('same-page click_xy does not wait out a popup grace', async () => {
    const hold = `<!doctype html><title>dice</title>
<style>html, body { margin: 0; }</style>
<button id="b" style="position:fixed;inset:0">Hold</button>
<p id="n">0</p>
<script>
  document.getElementById('b').addEventListener('click', () => {
    const el = document.getElementById('n');
    el.textContent = String(Number(el.textContent) + 1);
  });
</script>`;
    const site = await serve({ '/': hold });
    close = site.close;
    session = new Session();
    await session.goto(`${site.origin}/`);
    const clicks = 6;
    const started = performance.now();
    for (let i = 0; i < clicks; i++) await session.clickXy({ x: 40, y: 40 });
    const elapsed = performance.now() - started;
    const after = await session.snapshot();
    expect(after.text).toContain(String(clicks));
    expect(after.url).toBe(`${site.origin}/`);
    // A fixed 200ms grace would put six clicks over a second.
    expect(elapsed).toBeLessThan(500);
  });
});
