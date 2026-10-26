import type { SnapshotNode } from '../types.js';

export type AxNode = {
  role?: string;
  name?: string;
  value?: string;
  checked?: boolean | 'mixed';
  disabled?: boolean;
  focused?: boolean;
  children?: AxNode[];
  backendDOMNodeId?: number;
};

const INTERACTIVE = new Set([
  'button', 'link', 'textbox', 'searchbox', 'combobox', 'listbox', 'option',
  'checkbox', 'radio', 'switch', 'slider', 'spinbutton', 'menuitem', 'tab',
]);

function isInteresting(n: AxNode): boolean {
  const role = (n.role || '').toLowerCase();
  const name = (n.name || '').trim();
  if (INTERACTIVE.has(role)) return true;
  if (['heading', 'text', 'image'].includes(role) && name) return true;
  return false;
}

export function serializeAxTree(root: AxNode): { text: string; nodes: SnapshotNode[] } {
  const nodes: SnapshotNode[] = [];
  const lines: string[] = [];
  let i = 0;

  const walk = (n: AxNode, depth: number) => {
    if (isInteresting(n)) {
      const role = (n.role || 'generic').toLowerCase();
      const name = (n.name || '').replace(/\s+/g, ' ').trim();
      const states: string[] = [];
      if (n.disabled) states.push('disabled');
      if (n.checked === true) states.push('checked');
      if (n.checked === 'mixed') states.push('mixed');
      if (n.focused) states.push('focused');
      const stateStr = states.length ? ` (${states.join(', ')})` : '';
      // BC FIX: eN only for actionable; headings/text never consume the counter
      let refStr = '';
      if (INTERACTIVE.has(role)) {
        i += 1;
        const ref = `e${i}`;
        refStr = ` [ref=${ref}]`;
        nodes.push({ ref, role, name, states: states.length ? states : undefined });
      }
      lines.push(`${'  '.repeat(depth)}${role}${name ? ` "${name}"` : ''}${stateStr}${refStr}`);
    }
    for (const c of n.children || []) walk(c, depth + (isInteresting(n) ? 1 : 0));
  };

  walk(root, 0);
  return { text: lines.join('\n'), nodes };
}
