import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CANVAS_HEAVY_COVERAGE,
  MIXED_OUTSIDE_MIN,
  SPARSE_MAX_TOTAL,
  classifySnapshotHints,
  countSnapshotLines,
  formatHints,
} from '../../src/hints.js';
import { centerOutside, visibleCoverage } from '../../src/geometry.js';

describe('classifySnapshotHints', () => {
  it('locks the documented thresholds', () => {
    expect(CANVAS_HEAVY_COVERAGE).toBe(0.6);
    expect(MIXED_OUTSIDE_MIN).toBe(3);
    expect(SPARSE_MAX_TOTAL).toBe(3);
  });

  it('treats an empty tree with no canvas as sparse', () => {
    const hints = classifySnapshotHints({
      actionable: 0, total: 0, largestCoverage: 0, actionableOutsideCanvas: 0,
    });
    expect(hints.mode).toBe('sparse');
    expect(hints.reasons.join(' ')).toMatch(/empty or sparse/);
    expect(hints.reasons.join(' ')).toMatch(/no canvas/);
  });

  it('treats a heading-only tree as sparse and a long article as a11y', () => {
    const heading = classifySnapshotHints({
      actionable: 0, total: SPARSE_MAX_TOTAL, largestCoverage: 0, actionableOutsideCanvas: 0,
    });
    expect(heading.mode).toBe('sparse');

    const article = classifySnapshotHints({
      actionable: 0, total: SPARSE_MAX_TOTAL + 1, largestCoverage: 0, actionableOutsideCanvas: 0,
    });
    expect(article.mode).toBe('a11y');

    const oneLink = classifySnapshotHints({
      actionable: 1, total: 3, largestCoverage: 0, actionableOutsideCanvas: 0,
    });
    expect(oneLink.mode).toBe('a11y');
  });

  it('keeps a small canvas on a form in a11y', () => {
    const hints = classifySnapshotHints({
      actionable: 4,
      total: 6,
      largestCoverage: CANVAS_HEAVY_COVERAGE - 0.01,
      actionableOutsideCanvas: 10,
    });
    expect(hints.mode).toBe('a11y');
    expect(hints.reasons.join(' ')).toMatch(/below 60%/);
  });

  it('classifies a dominant canvas with few outside controls as canvas', () => {
    for (const outside of [0, MIXED_OUTSIDE_MIN - 1]) {
      const hints = classifySnapshotHints({
        actionable: 0,
        total: 0,
        largestCoverage: CANVAS_HEAVY_COVERAGE,
        actionableOutsideCanvas: outside,
      });
      expect(hints.mode).toBe('canvas');
    }
  });

  it('classifies canvas-heavy chrome plus stage as mixed', () => {
    const hints = classifySnapshotHints({
      actionable: 4,
      total: 6,
      largestCoverage: 0.8,
      actionableOutsideCanvas: MIXED_OUTSIDE_MIN,
    });
    expect(hints.mode).toBe('mixed');
    expect(hints.reasons.join(' ')).toMatch(/80%/);
    expect(hints.reasons.join(' ')).toMatch(/outside/);
  });

  it('prefers canvas over sparse when the tree is empty but the canvas fills the viewport', () => {
    const hints = classifySnapshotHints({
      actionable: 0, total: 0, largestCoverage: 0.95, actionableOutsideCanvas: 0,
    });
    expect(hints.mode).toBe('canvas');
  });

  it('reasons stay factual and do not promise a tool switch', () => {
    const hints = classifySnapshotHints({
      actionable: 0, total: 0, largestCoverage: 0.9, actionableOutsideCanvas: 4,
    });
    expect(hints.reasons.join(' ')).not.toMatch(/auto-?switch|ocr|vision|captcha/i);
  });

  it('puts hints on one JSON line', () => {
    const hints = classifySnapshotHints({
      actionable: 2, total: 2, largestCoverage: 0, actionableOutsideCanvas: 0,
    });
    const line = formatHints(hints);
    expect(line.startsWith('hints: ')).toBe(true);
    expect(JSON.parse(line.slice('hints: '.length))).toEqual({ mode: hints.mode, reasons: hints.reasons });
  });

  it('does not count a blank serializer body as one line', () => {
    expect(countSnapshotLines('')).toBe(0);
    expect(countSnapshotLines('   \n')).toBe(0);
    expect(countSnapshotLines('button "Go" [ref=e1]\nheading "Title"')).toBe(2);
  });
});

describe('canvas geometry math', () => {
  const viewport = { width: 1000, height: 500 };

  it('measures visible canvas area against the viewport', () => {
    expect(visibleCoverage({ left: 0, top: 0, right: 1000, bottom: 500 }, viewport)).toBe(1);
    expect(visibleCoverage({ left: 0, top: 0, right: 600, bottom: 500 }, viewport)).toBe(0.6);
    expect(visibleCoverage({ left: -100, top: -100, right: 1100, bottom: 700 }, viewport)).toBe(1);
    expect(visibleCoverage({ left: 2000, top: 0, right: 2100, bottom: 100 }, viewport)).toBe(0);
    expect(visibleCoverage({ left: 0, top: 0, right: 100, bottom: 100 }, { width: 0, height: 0 })).toBe(0);
  });

  it('treats a control center outside the canvas box as outside', () => {
    const canvas = { x: 0, y: 0, width: 600, height: 500 };
    expect(centerOutside({ left: 10, top: 10, width: 40, height: 20 }, canvas)).toBe(false);
    expect(centerOutside({ left: 580, top: 10, width: 40, height: 20 }, canvas)).toBe(false);
    expect(centerOutside({ left: 700, top: 10, width: 40, height: 20 }, canvas)).toBe(true);
  });
});

describe('no site lists in the library', () => {
  it('src has no host allowlists or saved-site playbooks', () => {
    const root = join(process.cwd(), 'src');
    const files = walk(root);
    expect(files.length).toBeGreaterThan(0);
    const src = files.map((f) => readFileSync(f, 'utf8')).join('\n');
    expect(src).not.toMatch(/allowlist|playbook|booking\.com|ebay\.com|airbnb\.com/i);
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((ent) => {
    const path = join(dir, ent.name);
    if (ent.isDirectory()) return walk(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}
