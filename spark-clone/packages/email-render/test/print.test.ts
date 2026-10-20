// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildPrintDocument, sanitizeEmailHtml } from '../src';

describe('print document', () => {
  const quoted =
    '<p>Hi</p><blockquote type="cite">On Monday someone wrote: a long quoted history line</blockquote>';

  it('keeps quoted history unfolded when asked, so it prints', () => {
    expect(sanitizeEmailHtml(quoted).html).toContain('quote-fold');
    const { html } = sanitizeEmailHtml(quoted, { foldQuotes: false });
    expect(html).not.toContain('<details');
    expect(html).toContain('a long quoted history line');
  });

  it('escapes header fields and blocks scripts with a CSP', () => {
    const doc = buildPrintDocument('<b>Subject</b>', [
      { from: 'Eve <eve@x.example>', to: 'a@x.example', cc: '', date: 'Tue', html: '<p>body</p>' },
    ]);
    expect(doc).toContain('&lt;b&gt;Subject&lt;/b&gt;');
    expect(doc).toContain('Eve &lt;eve@x.example&gt;');
    expect(doc).toContain("script-src 'none'");
    expect(doc).toContain('<p>body</p>');
    expect(doc).not.toContain('>Cc<');
  });
});
