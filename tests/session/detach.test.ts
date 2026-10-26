import { describe, it, expect } from 'vitest';
import { Session } from '../../src/session.js';

function fake() {
  const calls = { closed: 0 };
  const browser = { close: async () => { calls.closed++; } } as any;
  const page = { url: () => 'about:blank' } as any;
  return { calls, handle: { browser, page, context: {} as any } };
}

describe('attach/detach (fake backends)', () => {
  it('attach closes managed first, detach from attached disconnects', async () => {
    const m = fake(); const a = fake();
    const s = new Session({ launchManaged: async () => m.handle, connectAttach: async () => a.handle });
    await (s as any).ensurePage();
    expect(s.mode).toBe('managed');
    await s.attach('http://127.0.0.1:9222');
    expect(m.calls.closed).toBe(1);
    expect(s.mode).toBe('attached');
    await s.detach();
    expect(a.calls.closed).toBe(1);
    expect(s.mode).toBe('idle');
  });

  it('detach from managed closes managed browser (no leak)', async () => {
    const m = fake();
    const s = new Session({ launchManaged: async () => m.handle });
    await (s as any).ensurePage();
    await s.detach();
    expect(m.calls.closed).toBe(1);
    expect(s.mode).toBe('idle');
  });

  it('attach failure leaves idle', async () => {
    const s = new Session({ connectAttach: async () => { throw new Error('ECONNREFUSED'); } });
    await expect(s.attach('http://127.0.0.1:1')).rejects.toThrow(/attach failed/);
    expect(s.mode).toBe('idle');
  });
});
