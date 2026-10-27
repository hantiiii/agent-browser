import { describe, expect, it } from 'vitest';
import { createServer } from '../../src/mcp/server.js';

type Registered = { description?: string };

describe('MCP tools', () => {
  it('exposes snapshot hints, screenshot, and click_xy', () => {
    const server = createServer() as unknown as { _registeredTools: Record<string, Registered> };
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
  });
});
