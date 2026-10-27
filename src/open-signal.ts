/**
 * Runs in the page. Notifies the host when this gesture is about to open
 * another page, before Chrome emits the CDP target. Idempotent.
 */
export function installOpenHook(): void {
  const w = globalThis as unknown as {
    __asbHooked?: boolean;
    __asbNotifyOpen?: (kind: string) => unknown;
    open: (this: unknown, ...args: unknown[]) => unknown;
    document: {
      addEventListener: (
        type: string,
        listener: (event: { target: unknown }) => void,
        capture?: boolean,
      ) => void;
    };
  };
  if (w.__asbHooked) return;
  w.__asbHooked = true;
  const orig = w.open.bind(w);
  w.open = function (this: unknown, ...args: unknown[]) {
    try {
      void w.__asbNotifyOpen?.('open');
    } catch {
      // Binding is best-effort. The real open still runs.
    }
    return orig.apply(this, args);
  };
  w.document.addEventListener('click', (event) => {
    const node = event.target as { nodeType?: number; parentElement?: unknown; closest?: (s: string) => { getAttribute: (n: string) => string | null } | null } | null;
    const el = node?.nodeType === 1 ? node : (node?.parentElement as typeof node);
    const anchor = el?.closest?.('a');
    if (!anchor) return;
    const target = (anchor.getAttribute('target') || '').toLowerCase();
    if (!target || target === '_self' || target === '_parent' || target === '_top') return;
    try {
      void w.__asbNotifyOpen?.('blank');
    } catch {
      // Ignore. The click still proceeds.
    }
  }, true);
}
