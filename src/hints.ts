import type { SnapshotHints } from './types.js';

/**
 * Advisory page mode from live measurements only.
 * No host lists, no saved sites, no tool switching.
 *
 * - canvas-heavy: largest canvas covers at least CANVAS_HEAVY_COVERAGE of the viewport
 * - mixed: canvas-heavy and at least MIXED_OUTSIDE_MIN controls sit outside that canvas
 * - sparse: not canvas-heavy, and the a11y tree is empty or nearly empty
 * - a11y: everything else (the default agents should keep using)
 */
export const CANVAS_HEAVY_COVERAGE = 0.6;
export const MIXED_OUTSIDE_MIN = 3;
/** No actionable refs and at most this many interesting lines counts as sparse. */
export const SPARSE_MAX_TOTAL = 3;

export type HintSignals = {
  /** Interactive refs (eN) from the a11y snapshot. */
  actionable: number;
  /** Interesting snapshot lines, including headings and text. */
  total: number;
  /** Largest canvas visible-area / viewport-area. 0 when there is no canvas. */
  largestCoverage: number;
  /** Visible DOM controls whose center lies outside that canvas. */
  actionableOutsideCanvas: number;
};

export function countSnapshotLines(text: string): number {
  if (!text.trim()) return 0;
  return text.split('\n').length;
}

function percent(coverage: number): string {
  return `${Math.round(coverage * 1000) / 10}%`;
}

export function classifySnapshotHints(input: HintSignals): SnapshotHints {
  const { actionable, total } = input;
  const coverage = input.largestCoverage;
  const outside = input.actionableOutsideCanvas;
  const canvasHeavy = coverage >= CANVAS_HEAVY_COVERAGE;
  const sparseTree = total === 0 || (actionable === 0 && total <= SPARSE_MAX_TOTAL);
  const thresholdPct = Math.round(CANVAS_HEAVY_COVERAGE * 100);
  const density = `${actionable} actionable refs among ${total} interesting nodes`;

  if (canvasHeavy) {
    const reasons = [
      `largest canvas covers ${percent(coverage)} of the viewport (canvas-heavy at ${thresholdPct}%)`,
      `${outside} actionable controls sit outside that canvas (mixed at ${MIXED_OUTSIDE_MIN})`,
      density,
    ];
    return { mode: outside >= MIXED_OUTSIDE_MIN ? 'mixed' : 'canvas', reasons };
  }

  const canvasReason = coverage > 0
    ? `largest canvas covers ${percent(coverage)} of the viewport (below ${thresholdPct}%)`
    : 'no canvas covers the viewport';

  if (sparseTree) {
    return {
      mode: 'sparse',
      reasons: [canvasReason, density, 'accessibility tree is empty or sparse'],
    };
  }
  return { mode: 'a11y', reasons: [canvasReason, density] };
}

/** One machine-readable line appended to snapshot text. */
export function formatHints(hints: SnapshotHints): string {
  return `hints: ${JSON.stringify({ mode: hints.mode, reasons: hints.reasons })}`;
}
