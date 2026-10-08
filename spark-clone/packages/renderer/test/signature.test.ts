// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { normalizeSignatureHtml, signatureText } from '../src/lib/signature';

describe('signature helpers', () => {
  it('keeps the line breaks of a plain-text signature saved by the old textarea', () => {
    const html = normalizeSignatureHtml(
      'Ruben Andino\nSenior Fullstack Web Developer\n\nhttps://unsdsn.org',
    );
    expect(html).toBe(
      '<div>Ruben Andino</div><div>Senior Fullstack Web Developer</div><div><br></div>' +
        '<div><a href="https://unsdsn.org" target="_blank" rel="noreferrer noopener">https://unsdsn.org</a></div>',
    );
  });

  it('leaves saved HTML signatures as they were (sanitized)', () => {
    expect(normalizeSignatureHtml('<p>Rubén Andino</p>')).toBe(
      '<p style="margin:0">Rubén Andino</p>',
    );
    expect(normalizeSignatureHtml('   ')).toBe('');
  });

  it('flattens a table layout into readable plain text', () => {
    const text = signatureText(
      '<table><tr><td><img src="x"></td><td><b>Ruben Andino</b><br>Developer<br>' +
        '<a href="https://unsdsn.org">SDSN</a></td></tr></table>',
    );
    expect(text).toBe('Ruben Andino\nDeveloper\nSDSN');
  });
});
