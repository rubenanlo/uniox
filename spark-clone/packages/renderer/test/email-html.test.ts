// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { inlineEmailStyles } from '../src/lib/emailHtml';

describe('inlineEmailStyles', () => {
  it('leaves list-free HTML untouched', () => {
    const html = '<p>Hi <strong>there</strong></p>';
    expect(inlineEmailStyles(html)).toBe(html);
  });

  it('inlines compact indents on lists, items and item paragraphs', () => {
    const out = inlineEmailStyles('<ul><li><p>One</p></li><li><p>Two</p></li></ul>');
    const doc = new DOMParser().parseFromString(out, 'text/html');
    expect(doc.querySelector('ul')!.getAttribute('style')).toBe('margin:0 0 0.8em;padding-left:1.5em;');
    for (const li of doc.querySelectorAll('li')) expect(li.getAttribute('style')).toBe('margin:0 0 0.25em;');
    for (const p of doc.querySelectorAll('li > p')) expect(p.getAttribute('style')).toBe('margin:0;');
    expect(doc.body.textContent).toBe('OneTwo');
  });

  it('gives nested lists no bottom gap and handles ordered lists', () => {
    const out = inlineEmailStyles('<ol><li><p>CMS:</p><ul><li><p>Sanity</p></li></ul></li></ol>');
    const doc = new DOMParser().parseFromString(out, 'text/html');
    expect(doc.querySelector('ol')!.getAttribute('style')).toContain('padding-left:1.5em');
    expect(doc.querySelector('li ul')!.getAttribute('style')).toBe('margin:0.25em 0 0;padding-left:1.5em;');
  });

  it('keeps styles the editor already set', () => {
    const out = inlineEmailStyles('<ul style="color:red"><li><p>x</p></li></ul>');
    expect(out).toContain('style="margin:0 0 0.8em;padding-left:1.5em;color:red"');
  });
});
