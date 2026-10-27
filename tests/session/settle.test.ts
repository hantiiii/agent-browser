import { describe, it, expect } from 'vitest';
import { Session } from '../../src/session.js';
import { MAX_SETTLE_MS, resolveSettleMs } from '../../src/settle.js';

type Events = string[];

function fakeSession() {
  const events: Events = [];
  let failGoto = false;
  const page = {
    url: () => 'https://example.test/after',
    goto: async (_url: string, opts: { waitUntil?: string }) => {
      events.push(`goto:${opts?.waitUntil ?? ''}`);
      if (failGoto) throw new Error('navigation failed');
    },
    waitForTimeout: async (ms: number) => {
      events.push(`wait:${ms}`);
    },
    context: () => ({
      newCDPSession: async () => {
        events.push('ax');
        return {
          send: async (method: string) => {
            events.push(method);
            return { nodes: [] as unknown[] };
          },
          detach: async () => {},
        };
      },
    }),
  };
  let launched = 0;
  const session = new Session({
    launchManaged: async () => {
      launched += 1;
      return { browser: { close: async () => {} } as never, context: {} as never, page: page as never };
    },
  });
  return {
    session,
    events,
    launches: () => launched,
    setFailGoto: (v: boolean) => { failGoto = v; },
  };
}

describe('resolveSettleMs', () => {
  it('defaults to 0', () => {
    expect(resolveSettleMs(undefined)).toBe(0);
  });

  it('accepts 0 and the cap', () => {
    expect(resolveSettleMs(0)).toBe(0);
    expect(resolveSettleMs(MAX_SETTLE_MS)).toBe(MAX_SETTLE_MS);
  });

  it('rejects fractions, negatives, and values over the cap', () => {
    expect(() => resolveSettleMs(1.5)).toThrow(/settleMs/);
    expect(() => resolveSettleMs(-1)).toThrow(/settleMs/);
    expect(() => resolveSettleMs(MAX_SETTLE_MS + 1)).toThrow(String(MAX_SETTLE_MS));
  });
});

describe('Session settle', () => {
  it('goto keeps domcontentloaded and waits only when settleMs is set', async () => {
    const { session, events } = fakeSession();
    await session.goto('https://example.test/', { settleMs: 250 });
    expect(events).toEqual(['goto:domcontentloaded', 'wait:250']);

    events.length = 0;
    await session.goto('https://example.test/');
    expect(events).toEqual(['goto:domcontentloaded']);

    events.length = 0;
    await session.goto('https://example.test/', { settleMs: 0 });
    expect(events).toEqual(['goto:domcontentloaded']);
    await session.close();
  });

  it('does not settle when navigation fails', async () => {
    const { session, events, setFailGoto } = fakeSession();
    setFailGoto(true);
    const result = await session.goto('https://example.test/', { settleMs: 8000 });
    expect(result.ok).toBe(false);
    expect(events).toEqual(['goto:domcontentloaded']);
    await session.close();
  });

  it('rejects a bad settleMs before launching a browser', async () => {
    const { session, events, launches } = fakeSession();
    await expect(session.goto('https://example.test/', { settleMs: -5 })).rejects.toThrow(/settleMs/);
    await expect(session.snapshot({ settleMs: 1.2 })).rejects.toThrow(/settleMs/);
    expect(launches()).toBe(0);
    expect(events).toEqual([]);
    await session.close();
  });

  it('snapshot waits before reading the accessibility tree', async () => {
    const { session, events } = fakeSession();
    await session.snapshot({ settleMs: 100 });
    expect(events[0]).toBe('wait:100');
    expect(events).toContain('Accessibility.getFullAXTree');

    events.length = 0;
    await session.snapshot();
    expect(events[0]).toBe('ax');
    expect(events.some((e) => e.startsWith('wait:'))).toBe(false);
    await session.close();
  });
});
