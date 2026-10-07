// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  attachmentUrl,
  buildSrcdoc,
  escapeAndLinkify,
  IFRAME_SANDBOX,
  sanitizeEmailHtml,
  sanitizeRichText,
  textToHtml,
} from '../src';

const fixturesDir = join(__dirname, '../fixtures');
const fixtures = Object.fromEntries(
  readdirSync(fixturesDir)
    .filter((f) => f.endsWith('.html'))
    .map((f) => [f, readFileSync(join(fixturesDir, f), 'utf8')]),
);

describe('hostile corpus', () => {
  it('strips every script, iframe, object, form, base and event handler', () => {
    for (const [name, dirty] of Object.entries(fixtures)) {
      const { html } = sanitizeEmailHtml(dirty);
      const low = html.toLowerCase();
      for (const tag of ['<script', '<iframe', '<object', '<embed', '<form', '<base', '<meta', '<input']) {
        expect(low, `${name} must not contain ${tag}`).not.toContain(tag);
      }
      expect(low, `${name} must not keep inline handlers`).not.toMatch(/\son\w+\s*=/);
      expect(low, `${name} must not keep javascript: urls`).not.toContain('javascript:');
    }
  });

  it('neutralizes remote images (including tracking pixels) by default', () => {
    const { html, blockedImages } = sanitizeEmailHtml(fixtures['tracking-and-css.html']!);
    expect(blockedImages).toBeGreaterThanOrEqual(2);
    expect(html).not.toMatch(/\ssrc="https?:/i);
    expect(html).toContain('data-blocked-src');
  });

  it('keeps remote images when explicitly allowed', () => {
    const { html, blockedImages } = sanitizeEmailHtml(fixtures['tracking-and-css.html']!, {
      allowRemoteImages: true,
    });
    expect(blockedImages).toBe(0);
    expect(html).toMatch(/\ssrc="https?:/i);
  });

  it('resolves cid: images to app:// attachment urls', () => {
    const { html } = sanitizeEmailHtml(fixtures['messy-real-world.html']!, {
      attachments: [
        {
          id: 'a1',
          messageId: 'm1',
          filename: 'logo.png',
          contentType: 'image/png',
          size: 1,
          cid: 'logo@shop.example',
          localPath: 'm1/logo.png',
        },
      ],
    });
    expect(html).toContain('app://attachments/m1/logo.png');
    expect(html).not.toContain('cid:');
  });

  it('reports only cids actually referenced in the html as inline', () => {
    const att = (id: string, cid: string) => ({
      id,
      messageId: 'm1',
      filename: `${id}.png`,
      contentType: 'image/png',
      size: 1,
      cid,
      localPath: `m1/${id}.png`,
    });
    const { inlineCids } = sanitizeEmailHtml('<img src="cid:shown@x"><p>hi</p>', {
      // Gmail puts a Content-ID on every attachment, including real files;
      // only a cid the body actually references makes an attachment inline.
      attachments: [att('a1', 'shown@x'), att('a2', 'real-file@x')],
    });
    expect(inlineCids).toEqual(['shown@x']);
  });

  it('treats angle-bracketed cids as inline when referenced', () => {
    const { inlineCids } = sanitizeEmailHtml('<img src="cid:pic@y">', {
      attachments: [
        {
          id: 'a1',
          messageId: 'm1',
          filename: 'pic.png',
          contentType: 'image/png',
          size: 1,
          cid: '<pic@y>',
          localPath: 'm1/pic.png',
        },
      ],
    });
    expect(inlineCids).toEqual(['pic@y']);
  });

  it('folds quoted history into details', () => {
    const { html } = sanitizeEmailHtml(fixtures['messy-real-world.html']!);
    expect(html).toContain('quote-fold');
  });

  it('forces links to open externally', () => {
    const { html } = sanitizeEmailHtml('<a href="https://x.example/y">link</a>');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('noreferrer');
  });
});

describe('srcdoc contract', () => {
  it('sandbox never includes allow-scripts', () => {
    expect(IFRAME_SANDBOX).not.toContain('allow-scripts');
  });

  it('embeds a script-src none CSP and base target', () => {
    const doc = buildSrcdoc('<p>hi</p>');
    expect(doc).toContain(`script-src 'none'`);
    expect(doc).toContain('<base target="_blank">');
    expect(doc).toContain('max-width: 640px');
  });

  it('blocks remote img-src in CSP unless allowed', () => {
    expect(buildSrcdoc('<p/>')).not.toMatch(/img-src[^;]*https:/);
    expect(buildSrcdoc('<p/>', { allowRemoteImages: true })).toMatch(/img-src[^;]*https:/);
  });
});

describe('text fallback', () => {
  it('escapes html and links urls', () => {
    const html = textToHtml('see <b>this</b> at https://x.example/path');
    expect(html).toContain('&lt;b&gt;');
    expect(html).toContain('<a href="https://x.example/path"');
  });
});

describe('dark-mode text adaptation', () => {
  it('strips hardcoded dark text colors so the theme foreground applies', () => {
    const { html } = sanitizeEmailHtml(
      '<p style="color:black">a</p><p style="color:#111">b</p><p style="color: rgb(20,20,20)">c</p>',
      { darkMode: true },
    );
    expect(html).not.toMatch(/color:\s*(black|#111|rgb)/i);
  });

  it('strips Outlook windowtext and <font color> in dark mode', () => {
    const { html } = sanitizeEmailHtml(
      '<span style="color:windowtext">a</span><font color="#000000">b</font>',
      { darkMode: true },
    );
    expect(html).not.toContain('windowtext');
    expect(html).not.toContain('color="#000000"');
  });

  it('keeps dark text that sits on an explicit light background', () => {
    const { html } = sanitizeEmailHtml(
      '<div style="background-color:#ffffff"><p style="color:#000">kept</p></div>',
      { darkMode: true },
    );
    expect(html).toMatch(/color:\s*(#000|rgb\(0,\s*0,\s*0\))/i);
  });

  it('keeps light and brand colors untouched', () => {
    const { html } = sanitizeEmailHtml(
      '<p style="color:#ffffff">w</p><a style="color:#1a73e8">link</a>',
      { darkMode: true },
    );
    expect(html).toMatch(/color:\s*(#ffffff|rgb\(255,\s*255,\s*255\))/i);
    expect(html).toMatch(/color:\s*(#1a73e8|rgb\(26,\s*115,\s*232\))/i);
  });

  it('keeps dark text inside a light bgcolor table (Outlook layout)', () => {
    const { html } = sanitizeEmailHtml(
      '<table bgcolor="#ffffff"><tr><td><span style="color:#000">kept</span></td></tr></table>',
      { darkMode: true },
    );
    expect(html).toMatch(/color:\s*(#000|rgb\(0,\s*0,\s*0\))/i);
  });

  it('leaves everything alone outside dark mode', () => {
    const { html } = sanitizeEmailHtml('<p style="color:black">a</p>', {});
    expect(html).toMatch(/color:\s*black/i);
  });
});

describe('rich text and plain text escaping', () => {
  it('escapes quotes so a URL cannot inject attributes', () => {
    const html = escapeAndLinkify('https://x.example/"style="position:fixed"x="');
    expect(html).not.toContain('style="');
    expect(html).toContain('&quot;');
  });

  it('strips styles, style blocks and remote sources from rich text', () => {
    const out = sanitizeRichText(
      '<p>x</p><style>body{display:none}</style><div style="position:fixed">y</div>' +
        '<picture><source srcset="https://t.example/b.png"></picture><img src="https://t.example/i.png">' +
        '<a href="javascript:alert(1)">bad</a><a href="https://ok.example">ok</a>',
    );
    expect(out).not.toMatch(/<style|style=|srcset|<img|javascript:/i);
    expect(out).toContain('href="https://ok.example"');
  });

  it('encodes # and ? in attachment URLs', () => {
    expect(attachmentUrl({ localPath: 'm1/logo#2?.png' } as never)).toBe(
      'app://attachments/m1/logo%232%3F.png',
    );
  });
});
