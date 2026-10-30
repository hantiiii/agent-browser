import { describe, expect, it } from 'vitest';
import { createServer } from '../../src/mcp/server.js';

type Registered = { description?: string };

describe('MCP tools', () => {
  it('exposes snapshot hints, screenshot, and click_xy', () => {
    const server = createServer() as unknown as {
      _registeredTools: Record<string, Registered>;
      server: { _serverInfo: { name: string; title?: string; version: string } };
    };
    expect(server.server._serverInfo).toMatchObject({
      name: 'agent-smith-browser',
      title: 'Agent Smith Browser',
      version: '0.2.0',
    });
    const tools = server._registeredTools;
    expect(Object.keys(tools).sort()).toEqual([
      'act',
      'attach',
      'click_xy',
      'detach',
      'goto',
      'screenshot',
      'snapshot',
    ]);
    expect(tools.snapshot?.description).toMatch(/hints/);
    expect(tools.snapshot?.description).toMatch(/do not switch/);
    expect(tools.screenshot?.description).toMatch(/CSS pixel/);
    expect(tools.click_xy?.description).toMatch(/normalized/);
    expect(tools.click_xy?.description).toMatch(/viewport/);
    expect(tools.goto?.description).toMatch(/file, chrome, edge, and devtools URLs are refused/);
    expect(tools.attach?.description).toMatch(/loopback/);
    expect(tools.attach?.description).toMatch(/Remote hosts are refused/);
    expect(tools.attach?.description).toMatch(/first open tab/);
  });
});
