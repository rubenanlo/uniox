// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { sanitizeSignatureHtml } from '../src';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('sanitizeSignatureHtml', () => {
  it('keeps the look of a pasted signature: tables, inline styles, links and images', () => {
    const html = sanitizeSignatureHtml(
      `<table><tr><td><img src="${PNG}" width="240"></td>` +
        `<td><b style="font-size:20px;color:#888">Ruben Andino</b><br>` +
        `<a href="https://unsdsn.org">SDSN</a> <a href="mailto:r@x.org">r@x.org</a></td></tr></table>`,
    );
    expect(html).toContain('<table>');
    expect(html).toContain(`src="${PNG}"`);
    expect(html).toContain('width="240"');
    expect(html).toContain('font-size:20px');
    expect(html).toContain('href="https://unsdsn.org"');
    expect(html).toContain('href="mailto:r@x.org"');
  });

  it('drops scripts, handlers, styles, forms and javascript: links', () => {
    const html = sanitizeSignatureHtml(
      '<style>body{display:none}</style><script>alert(1)</script><img src=x onerror="alert(1)">' +
        '<a href="javascript:alert(1)">x</a><form><input></form><iframe src="https://x"></iframe>',
    ).toLowerCase();
    for (const bad of [
      '<style',
      '<script',
      'onerror',
      'javascript:',
      '<form',
      '<input',
      '<iframe',
    ]) {
      expect(html).not.toContain(bad);
    }
  });

  it('strips CSS that could cover the app or load remote resources', () => {
    const html = sanitizeSignatureHtml(
      '<div style="position:fixed;inset:0;z-index:99;color:red;background:url(https://t.example/p.gif)">x</div>',
    );
    expect(html).toContain('color:red');
    expect(html).not.toMatch(/position|z-index|url\(/);
  });

  it('removes image sources it cannot keep, leaving the <img> to be filled', () => {
    const html = sanitizeSignatureHtml(
      '<img src="webkit-fake-url://abc/logo.png"><img src="file:///C:/logo.png"><img src="cid:logo@x"><img src="https://x.org/a.png">',
    );
    expect(html).toBe('<img><img><img src="cid:logo@x"><img src="https://x.org/a.png">');
  });

  it('removes Office comments and zeroes paragraph margins Word set in a stylesheet', () => {
    const html = sanitizeSignatureHtml(
      '<!--StartFragment--><p class="MsoNormal">Ruben<o:p></o:p></p><p style="margin:4px">x</p><!--EndFragment-->',
    );
    expect(html).toBe('<p style="margin:0">Ruben</p><p style="margin:4px">x</p>');
  });
});
