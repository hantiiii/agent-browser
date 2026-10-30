import { AgentBrowserError } from './types.js';

const CDP_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:']);
const NAV_SCHEMES = new Set(['http:', 'https:', 'data:']);
const VERSION_BODY_MAX = 65_536;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * CDP attach dials the browser debug port. Only loopback is accepted so a
 * page cannot talk the agent into connecting to a remote or link-local host.
 * Tunnels still work when they listen on 127.0.0.1, localhost, or ::1.
 */
export function assertLoopbackCdpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('invalid CDP url; expected http://127.0.0.1:9222 or ws://127.0.0.1:9222/devtools/browser/…');
  }
  if (url.username || url.password) {
    throw new Error('refusing a CDP url with embedded credentials');
  }
  if (!CDP_SCHEMES.has(url.protocol)) {
    throw new Error(`refusing CDP scheme ${url.protocol}; expected http, https, ws, or wss on loopback`);
  }
  if (!isLoopbackHost(url.hostname)) {
    throw new Error(`refusing CDP host ${url.hostname}; attach only connects to loopback (127.0.0.1, localhost, or ::1)`);
  }
  return url;
}

/**
 * Discover the browser websocket ourselves and require it to stay on loopback
 * at the same port. Playwright would otherwise trust webSocketDebuggerUrl and
 * follow one websocket redirect.
 */
export async function resolveCdpWebSocket(cdpUrl: string, doFetch: FetchLike = fetch): Promise<string> {
  const endpoint = assertLoopbackCdpUrl(cdpUrl);
  if (endpoint.protocol === 'ws:' || endpoint.protocol === 'wss:') return endpoint.href;
  const versionUrl = new URL('/json/version', endpoint.origin);
  const res = await doFetch(versionUrl.href, {
    redirect: 'manual',
    signal: AbortSignal.timeout(5_000),
    headers: { accept: 'application/json' },
  });
  if (res.status !== 200) {
    throw new Error(`CDP endpoint returned HTTP ${res.status}`);
  }
  const text = await readLimited(res, VERSION_BODY_MAX);
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('CDP endpoint did not return JSON');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('CDP version payload was not an object');
  }
  const wsRaw = (payload as { webSocketDebuggerUrl?: unknown }).webSocketDebuggerUrl;
  if (typeof wsRaw !== 'string' || wsRaw.length === 0 || wsRaw.length > 2048) {
    throw new Error('CDP endpoint did not return a webSocketDebuggerUrl');
  }
  const ws = assertLoopbackCdpUrl(wsRaw);
  if (ws.protocol !== 'ws:' && ws.protocol !== 'wss:') {
    throw new Error('webSocketDebuggerUrl must use ws or wss');
  }
  if (ws.port !== endpoint.port) {
    throw new Error('webSocketDebuggerUrl port does not match the CDP endpoint');
  }
  return ws.href;
}

/** http(s) and data only. file, chrome, edge, devtools, and similar schemes are refused. */
export function assertNavigableUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AgentBrowserError('url must be an absolute http, https, or data URL');
  }
  if (url.username || url.password) {
    throw new AgentBrowserError('refusing a navigation URL with embedded credentials');
  }
  if (!NAV_SCHEMES.has(url.protocol)) {
    throw new AgentBrowserError(
      `refusing to open ${url.protocol} URLs. file, chrome, edge, devtools, and other local schemes are blocked`,
    );
  }
  return raw;
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

async function readLimited(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    if (text.length > max) throw new Error('CDP version response is too large');
    return text;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new Error('CDP version response is too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
