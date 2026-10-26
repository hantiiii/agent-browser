import { describe, it, expect, afterEach } from 'vitest';
import { Session } from '../../src/session.js';

// Optional smoke: start Chrome/Edge with --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222
// then ATTACH_CDP_URL=http://127.0.0.1:9222 npx vitest run tests/integration/attach.test.ts
const url = process.env.ATTACH_CDP_URL;

describe.skipIf(!url)('attach smoke', () => {
  let s: Session;
  afterEach(async () => { await s?.close(); });
  it('attach + goto + snapshot, detach leaves browser alive', async () => {
    s = new Session();
    await s.attach(url!);
    expect(s.mode).toBe('attached');
    await s.goto('https://example.com');
    const snap = await s.snapshot();
    expect(snap.text.toLowerCase()).toMatch(/example/);
    await s.detach();
    const res = await fetch(url!.replace(/^ws/, 'http').replace(/\/devtools.*$/, '') + '/json/version');
    expect(res.ok).toBe(true);
  });
});
