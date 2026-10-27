#!/usr/bin/env node
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Session } from '../session.js';
import { MAX_SETTLE_MS } from '../settle.js';
import type { ClickXyResult, ScreenshotResult } from '../types.js';

const require = createRequire(import.meta.url);
const { version } = require('../../package.json') as { version: string };

/** One process-wide session shared by all tool calls. */
const session = new Session();

type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

type ToolResult = { content: ToolContent[]; isError?: boolean };

const ok = (text: string): ToolResult => ({ content: [{ type: 'text', text }] });

function fail(e: unknown): ToolResult {
  const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
  return { content: [{ type: 'text', text: `error: ${msg}` }], isError: true };
}

const settleMsSchema = z.number().int().min(0).max(MAX_SETTLE_MS).optional().describe(
  `Optional pause in ms (default 0, max ${MAX_SETTLE_MS}). Plain wait after domcontentloaded on goto, or before the tree is read on snapshot. Try 8000–10000 when the page is still a shell, spinner, or bot interstitial. Not networkidle, and not a bypass.`,
);

/** Errors become plain text — message only, never a stack. */
async function run(fn: () => Promise<string>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (e) {
    return fail(e);
  }
}

function formatShot(shot: ScreenshotResult): string {
  return [
    `viewport ${shot.viewport.width}x${shot.viewport.height} css px`,
    `image ${shot.image.width}x${shot.image.height} px`,
    `fullPage=${shot.fullPage}`,
    'click_xy uses css pixels from the viewport origin, or space=normalized (0-1).',
    'Viewport screenshots use one image pixel per CSS pixel. A fullPage image is not a click_xy map.',
  ].join('\n');
}

function formatClick(r: ClickXyResult): string {
  const input = r.space === 'css' ? '' : ` normalized (${r.input.x}, ${r.input.y}) ->`;
  return `ok click_xy${input} css (${r.x}, ${r.y}) viewport ${r.viewport.width}x${r.viewport.height}`;
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'agent-smith-browser',
    title: 'Agent Smith Browser',
    version,
    description: 'Attach-first a11y+refs browser for AI agents, with advisory canvas hints (screenshot, click_xy, hints.mode).',
    websiteUrl: 'https://github.com/hantiiii/agent-smith-browser',
  });

  server.registerTool('goto', {
    description: 'Navigate the active page (waits for domcontentloaded, then optional settleMs). Invalidates refs; call snapshot next.',
    inputSchema: {
      url: z.string().describe('Absolute URL to open'),
      settleMs: settleMsSchema,
    },
  }, async ({ url, settleMs }) => run(async () => {
    const r = await session.goto(url, { settleMs });
    if (!r.ok) throw new Error(`goto failed: ${r.error}`);
    return `ok ${r.url} (mode=${session.mode})`;
  }));

  server.registerTool('snapshot', {
    description: 'Compact accessibility tree of the one active page. If the last act or click_xy opened a popup in the same browser context, this is that popup. Optional settleMs pauses before reading the tree. Interactive elements get refs e1, e2, … for act. Text ends with advisory hints (a11y | canvas | mixed | sparse) from live heuristics. Hints do not switch tools.',
    inputSchema: { settleMs: settleMsSchema },
  }, async ({ settleMs }) => run(async () => {
    const s = await session.snapshot({ settleMs });
    return `url: ${s.url}\n${s.text}`;
  }));

  server.registerTool('act', {
    description: 'Act on a ref from the last snapshot. click (no nav wait) | type (replaces value) | press (Playwright key name, e.g. Enter). A popup opened by the action becomes the active page. Snapshot again if the page may have changed.',
    inputSchema: {
      ref: z.string().regex(/^e\d+$/).describe('Ref from last snapshot, e.g. e3'),
      kind: z.enum(['click', 'type', 'press']),
      value: z.string().optional().describe('Text for type, key name for press'),
    },
  }, async ({ ref, kind, value }) => run(async () => {
    await session.act({ ref, kind, value });
    return `ok ${kind} ${ref}`;
  }));

  server.registerTool('screenshot', {
    description: 'PNG of the active page. Default is the viewport at 1 image pixel per CSS pixel, so it maps to click_xy. fullPage captures the scrollable page and is not a click map. Does not replace snapshot/act and does not run vision.',
    inputSchema: {
      fullPage: z.boolean().optional().describe('Capture the full scrollable page. Default false (viewport only).'),
      settleMs: settleMsSchema,
    },
  }, async ({ fullPage, settleMs }) => {
    try {
      const shot = await session.screenshot({ fullPage, settleMs });
      return {
        content: [
          { type: 'text' as const, text: formatShot(shot) },
          { type: 'image' as const, data: shot.bytes.toString('base64'), mimeType: 'image/png' },
        ],
      };
    } catch (e) {
      return fail(e);
    }
  });

  server.registerTool('click_xy', {
    description: 'Click a viewport point. Default space is css (pixels from the top-left). space=normalized takes x and y in 0–1. Response includes the viewport size and the CSS point clicked. A popup opened by the click becomes the active page. Does not use a11y refs. Explicit tool: snapshot/act stay the default, and hints never call this for you.',
    inputSchema: {
      x: z.number().describe('X in CSS pixels, or 0–1 when space is normalized'),
      y: z.number().describe('Y in CSS pixels, or 0–1 when space is normalized'),
      space: z.enum(['css', 'normalized']).optional().describe('css (default) or normalized (0–1 of the viewport)'),
    },
  }, async ({ x, y, space }) => run(async () => formatClick(await session.clickXy({ x, y, space }))));

  server.registerTool('attach', {
    description: "Attach to the user's running Chrome/Edge via CDP (http://127.0.0.1:9222 or ws://…). Closes managed browser first. High trust: full control of that browser session.",
    inputSchema: { cdpUrl: z.string().describe('CDP endpoint, e.g. http://127.0.0.1:9222') },
  }, async ({ cdpUrl }) => run(async () => {
    const r = await session.attach(cdpUrl);
    return `ok attached ${r.url}`;
  }));

  server.registerTool('detach', {
    description: "Leave attached browser running (or close managed) and return to idle.",
    inputSchema: {},
  }, async () => run(async () => {
    await session.detach();
    return 'ok idle';
  }));

  return server;
}

export async function startServer(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  const shutdown = async () => { await session.close().catch(() => {}); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.stdin.on('close', shutdown);
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  startServer().catch((e) => {
    process.stderr.write(`asb mcp: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
