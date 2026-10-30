import { chromium, type Browser, type Page } from 'playwright';
import { resolveCdpWebSocket } from '../url-policy.js';

/**
 * Attach to a user's already-running Chrome/Edge started with
 * --remote-debugging-port bound to loopback. The endpoint must be
 * 127.0.0.1, localhost, or ::1. The discovered websocket is pinned to that
 * same port before Playwright connects, so a JSON discovery response cannot
 * point the debugger socket at another host.
 */
export async function connectAttach(cdpUrl: string): Promise<{ browser: Browser; page: Page }> {
  const endpoint = await resolveCdpWebSocket(cdpUrl);
  const browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0] ?? await browser.newContext();
  const page = context.pages()[0] ?? await context.newPage();
  return { browser, page };
}
