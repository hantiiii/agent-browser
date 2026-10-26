import { describe, it, expect, afterEach } from 'vitest';
import { Session } from '../../src/session.js';

describe('managed integration', () => {
  let session: Session;
  afterEach(async () => { await session?.close(); });

  it('goto + snapshot + click on example.com', async () => {
    session = new Session();
    const g = await session.goto('https://example.com');
    expect(g.ok).toBe(true);
    const snap = await session.snapshot();
    expect(snap.text.toLowerCase()).toMatch(/example|more information|domain/);
    expect(session.mode).toBe('managed');
  });
});
