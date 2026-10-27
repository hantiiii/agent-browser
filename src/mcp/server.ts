#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Session } from '../session.js';
import { MAX_SETTLE_MS } from '../settle.js';

/** One process-wide session shared by all tool calls. */
const session = new Session();

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const ok = (text: string): ToolResult => ({ content: [{ type: 'text', text }] });

const settleMsSchema = z.number().int().min(0).max(MAX_SETTLE_MS).optional().describe(
  `Optional pause in ms (default 0, max ${MAX_SETTLE_MS}). Plain wait after domcontentloaded on goto, or before the tree is read on snapshot. Try 8000–10000 when the page is still a shell, spinner, or bot interstitial. Not networkidle, and not a bypass.`,
);

/** Errors become plain text — message only, never a stack. */
async function run(fn: () => Promise<string>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (e) {
    const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
    return { content: [{ type: 'text', text: `error: ${msg}` }], isError: true };
  }
}

export function createServer(): McpServer {
  const server = new McpServer({ name: 'agent-browser', version: '0.1.0' });

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
    description: 'Compact accessibility tree of the active tab. Optional settleMs pauses before reading the tree. Interactive elements get refs e1, e2, … for act.',
    inputSchema: { settleMs: settleMsSchema },
  }, async ({ settleMs }) => run(async () => {
    const s = await session.snapshot({ settleMs });
    return `url: ${s.url}\n${s.text}`;
  }));

  server.registerTool('act', {
    description: 'Act on a ref from the last snapshot. click (no nav wait) | type (replaces value) | press (Playwright key name, e.g. Enter). Snapshot again if the page may have changed.',
    inputSchema: {
      ref: z.string().regex(/^e\d+$/).describe('Ref from last snapshot, e.g. e3'),
      kind: z.enum(['click', 'type', 'press']),
      value: z.string().optional().describe('Text for type, key name for press'),
    },
  }, async ({ ref, kind, value }) => run(async () => {
    await session.act({ ref, kind, value });
    return `ok ${kind} ${ref}`;
  }));

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

async function main() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  const shutdown = async () => { await session.close().catch(() => {}); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.stdin.on('close', shutdown);
}

main().catch((e) => {
  process.stderr.write(`agent-browser mcp: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
