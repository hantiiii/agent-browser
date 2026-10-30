import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '../src/session.js';
import {
  assertLoopbackCdpUrl,
  assertNavigableUrl,
  resolveCdpWebSocket,
} from '../src/url-policy.js';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  })));
});

async function listen(server: Server): Promise<number> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('test server has no port');
  return addr.port;
}

describe('CDP endpoint', () => {
  it('accepts loopback http and ws endpoints', () => {
    expect(assertLoopbackCdpUrl('http://127.0.0.1:9222').origin).toBe('http://127.0.0.1:9222');
    expect(assertLoopbackCdpUrl('http://LOCALHOST:9222').hostname).toBe('localhost');
    expect(assertLoopbackCdpUrl('http://[::1]:9222').hostname.replace(/[[\]]/g, '')).toBe('::1');
    expect(assertLoopbackCdpUrl('ws://127.0.0.1:9222/devtools/browser/abc').protocol).toBe('ws:');
    // WHATWG normalization of these forms is loopback, so they stay on this machine.
    expect(assertLoopbackCdpUrl('http://2130706433:9222').hostname).toBe('127.0.0.1');
    expect(assertLoopbackCdpUrl('http://127.1:9222').hostname).toBe('127.0.0.1');
  });

  it('refuses remote hosts, credentials, and non-debugger schemes', () => {
    expect(() => assertLoopbackCdpUrl('http://evil.example:9222')).toThrow(/loopback/);
    expect(() => assertLoopbackCdpUrl('http://169.254.169.254/latest/meta-data')).toThrow(/loopback/);
    expect(() => assertLoopbackCdpUrl('http://0.0.0.0:9222')).toThrow(/loopback/);
    expect(() => assertLoopbackCdpUrl('http://127.0.0.1.evil.com:9222')).toThrow(/loopback/);
    expect(() => assertLoopbackCdpUrl('http://localhost.:9222')).toThrow(/loopback/);
    expect(() => assertLoopbackCdpUrl('http://user:secret@127.0.0.1:9222')).toThrow(/credential/i);
    expect(() => assertLoopbackCdpUrl('http://127.0.0.1:9222@evil.com')).toThrow(/loopback|credential/i);
    expect(() => assertLoopbackCdpUrl('file:///tmp/chrome')).toThrow(/scheme/i);
    expect(() => assertLoopbackCdpUrl('not a url')).toThrow(/invalid CDP url/);
    expect(() => assertLoopbackCdpUrl('http://user:secret@127.0.0.1:9222')).not.toThrow(/secret/);
  });

  it('returns a ws endpoint directly and does not fetch', async () => {
    const ws = 'ws://127.0.0.1:9222/devtools/browser/abc';
    await expect(resolveCdpWebSocket(ws, async () => {
      throw new Error('should not fetch');
    })).resolves.toBe(ws);
  });

  it('accepts a same-port loopback debugger socket from /json/version', async () => {
    const server = createServer((req, res) => {
      expect(req.url).toBe('/json/version');
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        webSocketDebuggerUrl: `ws://localhost:${port}/devtools/browser/uuid`,
      }));
    });
    const port = await listen(server);
    await expect(resolveCdpWebSocket(`http://127.0.0.1:${port}/json/version/`)).resolves.toBe(
      `ws://localhost:${port}/devtools/browser/uuid`,
    );
  });

  it('refuses a debugger socket that leaves the loopback port', async () => {
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ webSocketDebuggerUrl: 'ws://evil.example:9222/devtools/browser/x' }));
    });
    const port = await listen(server);
    await expect(resolveCdpWebSocket(`http://127.0.0.1:${port}`)).rejects.toThrow(/loopback/);
  });

  it('refuses a debugger socket on a different port', async () => {
    const server = createServer((_req, res) => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      res.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${port + 1}/devtools/browser/x` }));
    });
    const port = await listen(server);
    await expect(resolveCdpWebSocket(`http://127.0.0.1:${port}`)).rejects.toThrow(/port/);
  });

  it('does not follow an HTTP redirect', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(302, { location: 'http://127.0.0.1:1/secret' });
      res.end();
    });
    const port = await listen(server);
    await expect(resolveCdpWebSocket(`http://127.0.0.1:${port}`)).rejects.toThrow(/HTTP 302/);
  });

  it('refuses an oversized version payload', async () => {
    const server = createServer((_req, res) => {
      res.end(JSON.stringify({ webSocketDebuggerUrl: 'ws://127.0.0.1:1/x', pad: 'A'.repeat(70_000) }));
    });
    const port = await listen(server);
    await expect(resolveCdpWebSocket(`http://127.0.0.1:${port}`)).rejects.toThrow(/too large/);
  });

  it('attach to a remote host fails before connect and leaves the session idle', async () => {
    const session = new Session();
    await expect(session.attach('http://169.254.169.254/latest/meta-data')).rejects.toThrow(/attach failed/i);
    expect(session.mode).toBe('idle');
    await expect(session.attach('ws://evil.example/devtools/browser/x')).rejects.toThrow(/loopback/);
  });
});

describe('navigation URLs', () => {
  it('allows http, https, and data', () => {
    expect(assertNavigableUrl('https://example.com/path?q=1')).toBe('https://example.com/path?q=1');
    expect(assertNavigableUrl('http://127.0.0.1:8080/')).toBe('http://127.0.0.1:8080/');
    expect(assertNavigableUrl('data:text/html,hi')).toBe('data:text/html,hi');
  });

  it('refuses local and browser-internal schemes without echoing the path', () => {
    const secret = 'file:///home/user/.ssh/id_rsa';
    expect(() => assertNavigableUrl(secret)).toThrow(/file:/);
    expect(() => assertNavigableUrl(secret)).not.toThrow(/id_rsa/);
    expect(() => assertNavigableUrl('chrome://password-manager')).toThrow(/chrome:/);
    expect(() => assertNavigableUrl('edge://settings')).toThrow(/edge:/);
    expect(() => assertNavigableUrl('devtools://devtools/bundled/inspector.html')).toThrow(/devtools:/);
    expect(() => assertNavigableUrl('view-source:https://example.com')).toThrow(/view-source:/);
    expect(() => assertNavigableUrl('javascript:alert(1)')).toThrow(/javascript:/);
    expect(() => assertNavigableUrl('about:blank')).toThrow(/about:/);
    expect(() => assertNavigableUrl('example.com')).toThrow(/absolute/i);
    expect(() => assertNavigableUrl('https://user:secret@example.com/')).toThrow(/credential/i);
    expect(() => assertNavigableUrl('https://user:secret@example.com/')).not.toThrow(/secret/);
  });

  it('goto rejects file and chrome URLs before launching a browser', async () => {
    let launched = 0;
    const session = new Session({
      launchManaged: async () => {
        launched += 1;
        throw new Error('should not launch');
      },
    });
    await expect(session.goto('file:///etc/passwd')).rejects.toThrow(/file:/);
    await expect(session.goto('chrome://settings')).rejects.toThrow(/chrome:/);
    expect(launched).toBe(0);
    expect(session.mode).toBe('idle');
  });
});
