import { chromium, type Browser, type Page } from 'playwright';

/**
 * Attach to a user's already-running Chrome/Edge started with
 * --remote-debugging-port (bind 127.0.0.1). Accepts http://host:port or ws://… endpoints.
 * Uses Playwright connectOverCDP — no custom CDP parser.
 */
export async function connectAttach(cdpUrl: string): Promise<{ browser: Browser; page: Page }> {
  if (!/^(https?|wss?):\/\//i.test(cdpUrl)) {
    throw new Error(`invalid CDP url ${cdpUrl}; expected http://127.0.0.1:9222 or ws://…`);
  }
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0] ?? await browser.newContext();
  const page = context.pages()[0] ?? await context.newPage();
  return { browser, page };
}
