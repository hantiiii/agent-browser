import { createServer, type Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Session } from '../../src/session.js';

const LATE_MS = 1200;

function pageHtml(): string {
  return `<!doctype html><title>settle</title>
<button id="b">Placeholder</button>
<script>
  document.getElementById('b').remove();
  setTimeout(() => {
    const n = document.createElement('button');
    n.textContent = 'Ready';
    document.body.appendChild(n);
  }, ${LATE_MS});
</script>`;
}

describe('settle integration (managed)', () => {
  let url = '';
  let server: Server;
  let session: Session;

  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(pageHtml());
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no port');
    url = `http://127.0.0.1:${addr.port}/`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  afterEach(async () => { await session?.close(); });

  it('snapshot right after domcontentloaded misses a late control; settleMs includes it', async () => {
    session = new Session();
    await session.goto(url);
    const early = await session.snapshot();
    expect(early.text).not.toContain('Ready');

    await session.goto(url, { settleMs: LATE_MS + 800 });
    const settled = await session.snapshot();
    expect(settled.text).toContain('Ready');
    expect(settled.text).toMatch(/\[ref=e\d+\]/);
  });
});
