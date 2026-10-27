import { describe, it, expect } from 'vitest';
import { serializeAxTree } from '../../src/a11y/serialize.js';

describe('serializeAxTree', () => {
  it('assigns eN refs to interactive nodes and drops empty generics', () => {
    const root = {
      role: 'RootWebArea',
      name: '',
      children: [
        { role: 'heading', name: 'Login', children: [] },
        { role: 'textbox', name: 'Email', children: [] },
        { role: 'button', name: 'Sign In', children: [] },
        { role: 'generic', name: '', children: [] },
      ],
    };
    const { text, nodes } = serializeAxTree(root);
    expect(text).toContain('heading "Login"');
    expect(text).not.toMatch(/heading "Login".*\[ref=/);
    expect(text).toMatch(/textbox "Email" \[ref=e1\]/);
    expect(text).toMatch(/button "Sign In" \[ref=e2\]/);
    expect(text).not.toMatch(/generic/);
    expect(nodes.map((n) => n.ref)).toEqual(['e1', 'e2']);
  });

  it('collapses non-breaking spaces in accessible names', () => {
    const root = {
      role: 'RootWebArea',
      name: '',
      children: [{ role: 'button', name: 'Go\u00a0\u00a0In', children: [] }],
    };
    const { text, nodes } = serializeAxTree(root);
    expect(nodes[0]?.name).toBe('Go In');
    expect(text).toContain('button "Go In"');
  });

  it('does not consume eN for non-actionable nodes (no holes)', () => {
    const root = {
      role: 'RootWebArea',
      name: '',
      children: [
        { role: 'heading', name: 'A', children: [] },
        { role: 'heading', name: 'B', children: [] },
        { role: 'button', name: 'Go', children: [] },
      ],
    };
    const { text, nodes } = serializeAxTree(root);
    expect(text).toContain('heading "A"');
    expect(text).toContain('heading "B"');
    expect(nodes.map((n) => n.ref)).toEqual(['e1']);
    expect(text).toMatch(/button "Go" \[ref=e1\]/);
  });
});
