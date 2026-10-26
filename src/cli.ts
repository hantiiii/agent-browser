import { Session } from './session.js';
import type { ActKind } from './types.js';

const HELP = `agent-browser — a11y snapshot + refs browser for AI agents

Usage (every command is one-shot: no daemon, no REPL, no session file):
  agent-browser mcp                         Run MCP server on stdio (use this for multi-step agents)
  agent-browser demo                        goto https://example.com and print snapshot (smoke)
  agent-browser goto <url> [--cdp <url>]    Navigate; prints JSON result
  agent-browser snapshot [url] [--cdp <url>] Print a11y snapshot (optionally goto url first)
  agent-browser act <ref> <click|type|press> [value] --cdp <url>
                                            Snapshot the attached tab, then act on <ref>
  agent-browser attach <cdpUrl>             Check that a Chrome/Edge CDP endpoint is reachable
  agent-browser detach                      No-op in one-shot CLI (nothing persists)

--cdp attaches to YOUR running Chrome/Edge (started with
  --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222).
  TRUST WARNING: attach gives this process full control of that browser profile
  (cookies, logged-in sessions, input). Only attach to a browser you are OK handing over.

Managed one-shots start a fresh browser and close it on exit, so state does not carry
between commands. For multi-step flows use "agent-browser mcp".`;

function out(v: unknown) { process.stdout.write(JSON.stringify(v, null, 2) + '\n'); }

function takeFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  if (!v) throw new Error(`${name} needs a value`);
  args.splice(i, 2);
  return v;
}

async function withSession<T>(cdp: string | undefined, fn: (s: Session) => Promise<T>): Promise<T> {
  const s = new Session();
  try {
    if (cdp) await s.attach(cdp);
    return await fn(s);
  } finally {
    // attached: disconnect only (user's browser keeps running); managed: close
    await s.close();
  }
}

async function main(argv: string[]) {
  const args = [...argv];
  const cmd = args.shift();
  if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') { console.log(HELP); return; }
  const cdp = takeFlag(args, '--cdp');

  switch (cmd) {
    case 'mcp':
      await import('./mcp/server.js');
      return;
    case 'demo':
      await withSession(undefined, async (s) => {
        await s.goto('https://example.com');
        console.log((await s.snapshot()).text);
      });
      return;
    case 'goto': {
      const url = args[0];
      if (!url) throw new Error('usage: agent-browser goto <url>');
      out(await withSession(cdp, (s) => s.goto(url)));
      return;
    }
    case 'snapshot':
      await withSession(cdp, async (s) => {
        if (args[0]) await s.goto(args[0]);
        const r = await s.snapshot();
        console.log(`url: ${r.url}\n${r.text}`);
      });
      return;
    case 'act': {
      const [ref, kind, value] = args;
      if (!ref || !kind) throw new Error('usage: agent-browser act <ref> <click|type|press> [value] --cdp <url>');
      if (!['click', 'type', 'press'].includes(kind)) throw new Error(`unknown kind ${kind}`);
      if (!cdp) throw new Error('one-shot act needs --cdp <url> (a managed browser would be blank). For multi-step use "agent-browser mcp".');
      out(await withSession(cdp, async (s) => {
        await s.snapshot();
        return s.act({ ref, kind: kind as ActKind, value });
      }));
      return;
    }
    case 'attach': {
      const url = args[0] ?? cdp;
      if (!url) throw new Error('usage: agent-browser attach <cdpUrl>');
      out(await withSession(undefined, (s) => s.attach(url)));
      return;
    }
    case 'detach':
      out({ ok: true, note: 'one-shot CLI keeps no session; use MCP for attach/detach lifecycle' });
      return;
    default:
      throw new Error(`unknown command ${cmd}\n\n${HELP}`);
  }
}

main(process.argv.slice(2)).catch((e) => {
  process.stderr.write(`error: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}\n`);
  process.exit(1);
});
