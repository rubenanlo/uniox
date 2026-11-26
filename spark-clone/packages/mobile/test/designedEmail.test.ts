import { describe, expect, it } from 'vitest';
import { isDesignedEmail } from '../src/lib/designedEmail';

const pad = (s: string) => s + ' '.repeat(500);
const layout = (inner: string) =>
  `<html><head><style>body{margin:0}</style></head><body><table width="100%"><tr><td><table width="600"><tr><td>${inner}</td></tr></table><table width="600"><tr><td>Footer</td></tr></table></td></tr></table></body></html>`;

describe('designed email detection', () => {
  it('treats a table layout with a style sheet as designed (shipping notice)', () => {
    expect(isDesignedEmail(pad(layout('<img src="logo.png"> Votre colis est arrivé')))).toBe(true);
  });

  it('treats a single-table newsletter with a style sheet and images as designed', () => {
    expect(
      isDesignedEmail(
        pad('<html><head><style>.a{}</style></head><body><img src="a"><img src="b"><p>Story</p></body></html>'),
      ),
    ).toBe(true);
  });

  it('keeps a plain Gmail message as a chat bubble', () => {
    expect(isDesignedEmail(pad('<div dir="ltr">Hi Ruben,<div><br></div><div>Sounds good.</div></div>'))).toBe(false);
    expect(isDesignedEmail(null)).toBe(false);
  });

  it('keeps a reply with a signature table as a bubble', () => {
    const sig = '<table><tr><td><img src="logo.png"></td><td>Alyson Marks<br>SDSN</td></tr></table>';
    expect(isDesignedEmail(pad(`<div dir="ltr">Thanks, will do.</div>${sig}`))).toBe(false);
  });

  it('ignores a newsletter that is only in the quoted history', () => {
    const quoted = `<div class="gmail_quote"><blockquote>${layout('Sale!')}</blockquote></div>`;
    expect(isDesignedEmail(pad(`<div dir="ltr">Have a look at this.</div>${quoted}`))).toBe(false);
  });

  it('keeps an Outlook message with its style sheet and signature tables as a bubble', () => {
    const outlook =
      '<html><head><style>p.MsoNormal{margin:0}</style></head><body><p class="MsoNormal">Hello all,</p><table><tr><td>Sig</td></tr></table><table><tr><td><img src="x"></td></tr></table></body></html>';
    expect(isDesignedEmail(pad(outlook))).toBe(false);
  });
});
