export type SessionMode = 'idle' | 'managed' | 'attached';
export type ActKind = 'click' | 'type' | 'press';

export type ActArgs = {
  ref: string;
  kind: ActKind;
  value?: string;
};

export type GotoResult = { ok: true; url: string } | { ok: false; error: string; url?: string };

export type SnapshotNode = {
  ref: string;
  role: string;
  name: string;
  states?: string[];
};

export type HintMode = 'a11y' | 'canvas' | 'mixed' | 'sparse';

/** Advisory only. Callers choose screenshot / click_xy; the library does not switch. */
export type SnapshotHints = {
  mode: HintMode;
  reasons: string[];
};

export type SnapshotResult = {
  text: string;
  nodes: SnapshotNode[];
  url: string;
  hints: SnapshotHints;
  /** True when this read is a different page or URL than the previous snapshot or screenshot. */
  pageChanged: boolean;
};

export type ClickSpace = 'css' | 'normalized';

export type ViewportSize = { width: number; height: number };

/**
 * Click a viewport point. `css` (default) is CSS pixels from the top-left of the viewport.
 * `normalized` is a 0–1 fraction of that viewport (x=1 is the right edge).
 */
export type ClickXyArgs = {
  x: number;
  y: number;
  space?: ClickSpace;
};

/** Set when this action opened another page in the same browser context. */
export type PopupNotice = {
  /** True only when that page stayed on the same http(s) origin and became the active page. */
  followed: boolean;
  url: string;
};

export type ActResult = {
  ok: true;
  url: string;
  popup?: PopupNotice;
};

export type ClickXyResult = {
  ok: true;
  /** CSS pixels actually clicked, viewport origin. */
  x: number;
  y: number;
  space: ClickSpace;
  /** Coordinates as passed, before normalized values are converted. */
  input: { x: number; y: number };
  viewport: ViewportSize;
  /** Document URL of the active page after the click. */
  url: string;
  popup?: PopupNotice;
};

export type ScreenshotResult = {
  ok: true;
  bytes: Buffer;
  mimeType: 'image/png';
  fullPage: boolean;
  /** CSS pixel viewport. click_xy uses this space. */
  viewport: ViewportSize;
  /** PNG pixel size. Viewport shots use CSS scale, so this matches `viewport` when fullPage is false. */
  image: ViewportSize;
  url: string;
  /** True when this shot is a different page or URL than the previous snapshot or screenshot. */
  pageChanged: boolean;
  /**
   * Set only when `awaitPaint` was requested.
   * True when the canvas sample changed, or two frames ran on a page with no canvas, before the cap.
   */
  painted?: boolean;
};

export class AgentBrowserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentBrowserError';
  }
}
