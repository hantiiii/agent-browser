import { describe, it, expect } from 'vitest';
import { main } from '../../src/cli.js';
import type { ActKind } from '../../src/types.js';

type Call = unknown[];

function stub() {
  const calls: Call[] = [];
  const session = {
    attach: async (url: string) => { calls.push(['attach', url]); },
    goto: async (url: string, opts?: { settleMs?: number }) => {
      calls.push(['goto', url, opts ?? null]);
      return { ok: true, url };
    },
    snapshot: async (opts?: { settleMs?: number }) => {
      calls.push(['snapshot', opts ?? null]);
      return { text: 'button "Go" [ref=e1]', url: 'https://example.test/' };
    },
    act: async (args: { ref: string; kind: ActKind; value?: string }) => {
      calls.push(['act', args]);
      return { ok: true };
    },
    screenshot: async () => { throw new Error('screenshot not stubbed'); },
    clickXy: async () => { throw new Error('clickXy not stubbed'); },
    close: async () => { calls.push(['close']); },
  };
  return { calls, createSession: () => session };
}

describe('CLI --settle-ms', () => {
  it('rejects a non-integer before opening a session', async () => {
    let opened = 0;
    await expect(main(['snapshot', '--settle-ms', 'nope'], {
      createSession: () => { opened += 1; throw new Error('should not open'); },
    })).rejects.toThrow(/--settle-ms/);
    await expect(main(['goto', 'https://example.test', '--settle-ms', '999999'], {
      createSession: () => { opened += 1; throw new Error('should not open'); },
    })).rejects.toThrow(/30000/);
    expect(opened).toBe(0);
  });

  it('applies settle once on snapshot <url>, and on the open tab otherwise', async () => {
    const nav = stub();
    await main(['snapshot', 'https://example.test/late', '--settle-ms', '8000'], { createSession: nav.createSession });
    expect(nav.calls).toEqual([
      ['goto', 'https://example.test/late', { settleMs: 8000 }],
      ['snapshot', null],
      ['close'],
    ]);

    const open = stub();
    await main(['snapshot', '--cdp', 'http://127.0.0.1:9222', '--settle-ms', '8000'], { createSession: open.createSession });
    expect(open.calls).toEqual([
      ['attach', 'http://127.0.0.1:9222'],
      ['snapshot', { settleMs: 8000 }],
      ['close'],
    ]);
  });

  it('defaults to no settle and passes the flag through goto', async () => {
    const plain = stub();
    await main(['snapshot', 'https://example.com'], { createSession: plain.createSession });
    expect(plain.calls).toEqual([
      ['goto', 'https://example.com', null],
      ['snapshot', null],
      ['close'],
    ]);

    const paced = stub();
    await main(['goto', 'https://example.com', '--settle-ms', '0'], { createSession: paced.createSession });
    expect(paced.calls[0]).toEqual(['goto', 'https://example.com', { settleMs: 0 }]);
  });

  it('waits before the implicit snapshot in act', async () => {
    const { calls, createSession } = stub();
    await main(['act', 'e1', 'click', '--cdp', 'http://127.0.0.1:9222', '--settle-ms', '1000'], { createSession });
    expect(calls).toEqual([
      ['attach', 'http://127.0.0.1:9222'],
      ['snapshot', { settleMs: 1000 }],
      ['act', { ref: 'e1', kind: 'click', value: undefined }],
      ['close'],
    ]);
  });

  it('mentions the flag in help', async () => {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    try {
      await main(['--help']);
    } finally {
      console.log = orig;
    }
    expect(lines.join('\n')).toContain('--settle-ms');
    expect(lines.join('\n')).toContain('domcontentloaded');
  });
});
