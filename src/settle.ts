import { AgentBrowserError } from './types.js';

/** Upper bound for an explicit post-domcontentloaded pause. Not a navigation timeout. */
export const MAX_SETTLE_MS = 30_000;

/**
 * Opt-in pause length. Omitted means 0 so simple pages stay fast.
 * Fractions, negatives, and huge sleeps are rejected.
 */
export function resolveSettleMs(ms?: number): number {
  if (ms == null) return 0;
  if (typeof ms !== 'number' || !Number.isInteger(ms) || ms < 0 || ms > MAX_SETTLE_MS) {
    throw new AgentBrowserError(`settleMs must be an integer from 0 to ${MAX_SETTLE_MS}`);
  }
  return ms;
}

/** CLI `--settle-ms` value. Digits only, same range as {@link resolveSettleMs}. */
export function parseSettleMsFlag(raw: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new AgentBrowserError(`--settle-ms must be an integer from 0 to ${MAX_SETTLE_MS}`);
  }
  return resolveSettleMs(Number(raw));
}
