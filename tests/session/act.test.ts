import { describe, it, expect, afterEach } from 'vitest';
import { Session } from '../../src/session.js';

const html = `<!doctype html><title>t</title>
<h1>Form</h1>
<label>Email <input id="e" value="old"></label>
<button onclick="document.getElementById('out').textContent='clicked:'+document.getElementById('e').value">Send</button>
<p id="out">none</p>`;
const url = 'data:text/html,' + encodeURIComponent(html);

describe('act semantics (managed)', () => {
  let s: Session;
  afterEach(async () => { await s?.close(); });

  it('type replaces value, click works, unknown ref is stale', async () => {
    s = new Session();
    await s.goto(url);
    const snap = await s.snapshot();
    const box = snap.nodes.find((n) => n.role === 'textbox')!;
    const btn = snap.nodes.find((n) => n.role === 'button')!;
    expect(box.ref).toBe('e1');
    expect(btn.ref).toBe('e2');
    await s.act({ ref: box.ref, kind: 'type', value: 'new@x.pl' });
    await s.act({ ref: btn.ref, kind: 'click' });
    const after = await s.snapshot();
    expect(after.text).toContain('clicked:new@x.pl');
    await expect(s.act({ ref: 'e99', kind: 'click' })).rejects.toThrow(/stale|snapshot first/i);
  });

  it('click matches a button name that uses a non-breaking space', async () => {
    const nbsp = `<!doctype html><meta charset="utf-8"><title>t</title>
<button id="b">Save&nbsp;(1)&nbsp;now</button>
<p id="out">none</p>
<script>
  document.getElementById('b').addEventListener('click', () => {
    document.getElementById('out').textContent = 'clicked';
  });
</script>`;
    s = new Session();
    await s.goto('data:text/html,' + encodeURIComponent(nbsp));
    const snap = await s.snapshot();
    const btn = snap.nodes.find((n) => n.role === 'button')!;
    expect(btn.name).toBe('Save (1) now');
    await s.act({ ref: btn.ref, kind: 'click' });
    const after = await s.snapshot();
    expect(after.text).toContain('clicked');
  });

  it('goto clears refs', async () => {
    s = new Session();
    await s.goto(url);
    await s.snapshot();
    await s.goto(url);
    await expect(s.act({ ref: 'e1', kind: 'click' })).rejects.toThrow(/snapshot first/i);
  });
});
