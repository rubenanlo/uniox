// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { descriptionToHtml } from '../src/lib/richText';

describe('descriptionToHtml', () => {
  it('sanitizes HTML descriptions and keeps formatting tags', () => {
    const html =
      '<span><span>Weekly check-in call for the SDSN data &amp; statistics team</span></span>' +
      '<br><u>underlined</u><b>bold</b><i>italic</i>' +
      '<a href="https://meet.google.com/x">link</a><script>alert(1)</script>';
    const out = descriptionToHtml(html);
    expect(out).toContain('data &amp; statistics');
    expect(out).toContain('<u>underlined</u>');
    expect(out).toContain('<b>bold</b>');
    expect(out).toContain('<i>italic</i>');
    expect(out).toContain('href="https://meet.google.com/x"');
    expect(out).not.toContain('script');
  });

  it('converts plain text to escaped HTML with line breaks and links', () => {
    const out = descriptionToHtml('a < b & c\nsee https://example.com/x now');
    expect(out).toBe(
      'a &lt; b &amp; c<br>see <a href="https://example.com/x">https://example.com/x</a> now',
    );
  });

  it('passes empty through', () => {
    expect(descriptionToHtml('')).toBe('');
  });
});
