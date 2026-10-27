import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from '../../src/cli.js';
import type { ActKind, ClickSpace } from '../../src/types.js';

type Call = unknown[];

function stub(handlers?: {
  screenshot?: (opts?: { fullPage?: boolean; settleMs?: number }) => Promise<unknown>;
  clickXy?: (args: { x: number; y: number; space?: ClickSpace }, opts?: { settleMs?: number }) => Promise<unknown>;
}) {
  const calls: Call[] = [];
  const session = {
    attach: async (url: string) => { calls.push(['attach', url]); },
    goto: async (url: string, opts?: { settleMs?: number }) => {
      calls.push(['goto', url, opts ?? null]);
      return { ok: true, url };
    },
    snapshot: async () => {
      calls.push(['snapshot']);
      return { text: 'hints: {"mode":"a11y","reasons":["no canvas covers the viewport"]}', url: 'https://example.test/' };
    },
    act: async (args: { ref: string; kind: ActKind; value?: string }) => {
      calls.push(['act', args]);
      return { ok: true };
    },
    screenshot: async (opts?: { fullPage?: boolean; settleMs?: number }) => {
      calls.push(['screenshot', opts ?? null]);
      if (handlers?.screenshot) return handlers.screenshot(opts);
      return {
        ok: true,
        bytes: Buffer.from('png-bytes'),
        mimeType: 'image/png',
        fullPage: Boolean(opts?.fullPage),
        viewport: { width: 800, height: 600 },
        image: { width: 800, height: opts?.fullPage ? 2000 : 600 },
      };
    },
    clickXy: async (
      args: { x: number; y: number; space?: ClickSpace },
      opts?: { settleMs?: number },
    ) => {
      calls.push(['clickXy', args, opts ?? null]);
      if (handlers?.clickXy) return handlers.clickXy(args, opts);
      return {
        ok: true,
        x: args.x,
        y: args.y,
        space: args.space ?? 'css',
        input: { x: args.x, y: args.y },
        viewport: { width: 800, height: 600 },
      };
    },
    close: async () => { calls.push(['close']); },
  };
  return { calls, createSession: () => session };
}

async function capture(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const orig = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  }) as typeof process.stdout.write;
  try {
    await fn();
  } finally {
    process.stdout.write = orig;
  }
  return chunks.join('');
}

describe('CLI screenshot and click-xy', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('writes screenshot bytes and prints viewport JSON', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-browser-test-'));
    dirs.push(dir);
    const dest = join(dir, 'shot.png');
    const { calls, createSession } = stub();
    const stdout = await capture(() => main(
      ['screenshot', 'https://example.test/board', '--full', '--out', dest, '--settle-ms', '50'],
      { createSession },
    ));
    expect(calls).toEqual([
      ['goto', 'https://example.test/board', { settleMs: 50 }],
      ['screenshot', { fullPage: true, settleMs: undefined }],
      ['close'],
    ]);
    expect(readFileSync(dest).toString()).toBe('png-bytes');
    const json = JSON.parse(stdout);
    expect(json).toMatchObject({
      ok: true,
      path: dest,
      byteLength: 'png-bytes'.length,
      fullPage: true,
      viewport: { width: 800, height: 600 },
      image: { width: 800, height: 2000 },
    });
    expect(json.bytes).toBeUndefined();
  });

  it('passes normalized click-xy through and requires a target', async () => {
    let opened = 0;
    await expect(main(['click-xy', '0.2', '0.4'], {
      createSession: () => { opened += 1; throw new Error('should not open'); },
    })).rejects.toThrow(/--cdp|page url/);
    expect(opened).toBe(0);

    const { calls, createSession } = stub();
    const stdout = await capture(() => main(
      ['click_xy', '0.25', '0.5', '--space', 'normalized', '--cdp', 'http://127.0.0.1:9222'],
      { createSession },
    ));
    expect(calls).toEqual([
      ['attach', 'http://127.0.0.1:9222'],
      ['clickXy', { x: 0.25, y: 0.5, space: 'normalized' }, null],
      ['close'],
    ]);
    expect(JSON.parse(stdout)).toMatchObject({
      ok: true,
      space: 'normalized',
      viewport: { width: 800, height: 600 },
    });
  });

  it('mentions hints, screenshot, and click-xy in help', async () => {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    try {
      await main(['--help']);
    } finally {
      console.log = orig;
    }
    const help = lines.join('\n');
    expect(help).toContain('screenshot');
    expect(help).toContain('click-xy');
    expect(help).toContain('normalized');
    expect(help).toContain('hints');
    expect(help).toMatch(/not a site list|not a\nsite list/);
  });
});
