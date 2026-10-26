import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { AxNode } from '../a11y/serialize.js';

export type BrowserHandle = { browser: Browser; context: BrowserContext; page: Page };

export async function launchManaged(opts: { headless?: boolean } = {}): Promise<BrowserHandle> {
  const browser = await chromium.launch({ headless: opts.headless ?? true });
  const context = await browser.newContext();
  const page = await context.newPage();
  return { browser, context, page };
}

type CdpAxNode = {
  nodeId: string;
  parentId?: string;
  childIds?: string[];
  ignored?: boolean;
  role?: { value?: string };
  name?: { value?: string };
  value?: { value?: unknown };
  properties?: { name: string; value: { value?: unknown } }[];
};

/**
 * Fetch the full AX tree via CDP `Accessibility.getFullAXTree`.
 * (`page.accessibility` was removed from Playwright; this is the supported low-level path.)
 * Ignored nodes are flattened: their children are lifted to the parent.
 */
export async function getAxTree(page: Page): Promise<AxNode> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as { nodes: CdpAxNode[] };
    const byId = new Map(nodes.map((n) => [n.nodeId, n]));
    const convert = (n: CdpAxNode): AxNode[] => {
      const children = (n.childIds || []).flatMap((id) => {
        const c = byId.get(id);
        return c ? convert(c) : [];
      });
      if (n.ignored) return children;
      const prop = (k: string) => n.properties?.find((p) => p.name === k)?.value?.value;
      let role = String(n.role?.value ?? '');
      if (role === 'StaticText') role = 'text';
      const checked = prop('checked');
      return [{
        role,
        name: String(n.name?.value ?? ''),
        value: n.value?.value != null ? String(n.value.value) : undefined,
        disabled: prop('disabled') === true,
        focused: prop('focused') === true,
        checked: checked === 'mixed' ? 'mixed' : checked === 'true' || checked === true,
        children,
      }];
    };
    const root = nodes.find((n) => !n.parentId) ?? nodes[0];
    const out = root ? convert(root) : [];
    return out.length === 1 ? out[0] : { role: 'RootWebArea', name: '', children: out };
  } finally {
    await cdp.detach().catch(() => {});
  }
}
