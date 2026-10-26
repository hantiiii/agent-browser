import { describe, it, expect } from 'vitest';
import { Session } from '../../src/session.js';
import { AgentBrowserError } from '../../src/types.js';

describe('Session mode', () => {
  it('act in idle without snapshot throws snapshot first', async () => {
    const s = new Session({ launchManaged: async () => { throw new Error('should not launch'); } });
    await expect(s.act({ ref: 'e1', kind: 'click' })).rejects.toThrow(/snapshot first/i);
  });

  it('detach from idle is no-op ok', async () => {
    const s = new Session();
    await expect(s.detach()).resolves.toMatchObject({ ok: true });
    expect(s.mode).toBe('idle');
  });
});
