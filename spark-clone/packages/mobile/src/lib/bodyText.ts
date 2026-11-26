/**
 * The readable text of an email for the chat bubbles. Some senders (shops,
 * newsletters) ship a text/plain part that is really HTML: literal "<br>"
 * tags, or table cells glued together with no breaks ("Détails de
 * commandeTransporteur"). When the plain part looks like that, rebuild the
 * text from the HTML part with its line and block breaks; otherwise tidy the
 * plain part the way the desktop chat view does (link targets and Gmail's
 * *bold* stars removed). DOM-free so it runs in tests.
 */

/** Tags that only ever appear in markup, never in a person's plain text. */
const MARKUP =
  /<\/?(?:br|p|div|span|td|tr|th|table|tbody|font|b|strong|i|em|u|a|img|li|ul|ol|h[1-6]|center|style|hr)(?:\s[^<>]*)?\/?>/i;

export function looksLikeHtml(text: string): boolean {
  return MARKUP.test(text);
}

const NAMED: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  laquo: '«',
  raquo: '»',
  euro: '€',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  bull: '•',
  middot: '·',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  eacute: 'é',
  egrave: 'è',
  ecirc: 'ê',
  agrave: 'à',
  acirc: 'â',
  ccedil: 'ç',
  ocirc: 'ô',
  ucirc: 'û',
  ugrave: 'ù',
  icirc: 'î',
  iuml: 'ï',
  euml: 'ë',
  Eacute: 'É',
  zwnj: '',
  zwj: '',
  shy: '',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return all;
      // Invisible preheader padding (zero-width joiners and friends).
      if (code === 0x200c || code === 0x200b || code === 0x200d || code === 0xfeff || code === 0x34f) return '';
      return String.fromCodePoint(code === 0xa0 ? 0x20 : code);
    }
    return NAMED[ref] ?? NAMED[ref.toLowerCase()] ?? all;
  });
}

// Paragraph-like blocks get a blank line around them; plain boxes (div, tr)
// only a line break, however deeply they nest.
const PARA = 'p|h[1-6]|ul|ol|blockquote|pre|table|dl|hr';
const BOX = 'div|tr|tbody|thead|tfoot|center|section|article|header|footer|main|address|dt|dd';
const SOFT = '\u0001';
const HARD = '\u0002';

/**
 * Markup to text. `keepNewlines` is for a plain part that carries stray tags:
 * its own line ends are real breaks. In a true HTML part they are only spaces.
 */
export function markupToText(src: string, keepNewlines = false): string {
  let s = src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(head|style|script|title)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!doctype[^>]*>/gi, '');
  s = keepNewlines ? s.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ') : s.replace(/\s+/g, ' ');
  s = s
    // A <br> at a line end is one break, not two.
    .replace(/<br\s*\/?>[ \t]*\n?/gi, '\n')
    .replace(/<li\b[^>]*>/gi, `${SOFT}• `)
    .replace(/<\/li\s*>/gi, SOFT)
    .replace(new RegExp(`<\\/?(?:${PARA})\\b[^>]*>`, 'gi'), HARD)
    .replace(new RegExp(`<\\/?(?:${BOX})\\b[^>]*>`, 'gi'), SOFT)
    // Neighbouring table cells stay on one line, apart.
    .replace(/<\/t[dh]\s*>/gi, ' ')
    .replace(/<[^<>]+>/g, '');
  s = decodeEntities(s).replace(/\u00a0/g, ' ');
  // Each run of block edges (plus any <br>s beside them) becomes one break,
  // or a blank line when a paragraph edge or two <br>s are in it.
  s = s.replace(/[ \t\n]*[\u0001\u0002][\u0001\u0002 \t\n]*/g, (run) => {
    const brs = (run.match(/\n/g) ?? []).length;
    return run.includes(HARD) || brs >= 2 ? '\n\n' : '\n';
  });
  return s
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Undo what mail apps do when they flatten HTML into the text/plain part:
 * Gmail writes bold as *bold* and every link as "text <url>" (wrapped over
 * lines when long), and an image link becomes "* <url>*". Same rules as the
 * desktop chat view (renderer/src/lib/quickReply.ts cleanPlainText).
 */
export function cleanPlainText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/^[ \t]*<(?:https?:\/\/|mailto:)[^<>\s]*(?:\n[^<>\s]+)*>[ \t]*(?:\n|$)/gim, '')
    .replace(/[ \t]*<(?:https?:\/\/|mailto:)[^<>\s]*(?:\n[^<>\s]+)*>/gi, '')
    .replace(/(\S)[ \t]*<[^<>\s@]+@[^<>\s]+>/g, '$1')
    .replace(/(^|[\s([|,;:])\*+(?=[^\s*])/gm, '$1')
    .replace(/([^\s*])\*+(?=$|[\s)\].,;:!?|])/gm, '$1')
    .split('\n')
    .filter((line) => !/^[ \t]*[*•][ \t*]*$/.test(line))
    .join('\n');
}

/** The text a bubble, preview or AI prompt should use for a message. */
export function bodyText(text: string | null | undefined, html: string | null | undefined): string | null {
  const plain = text?.trim() ? text : null;
  if (plain && !looksLikeHtml(plain)) return cleanPlainText(plain);
  if (html?.trim()) {
    const fromHtml = markupToText(html);
    if (fromHtml) return fromHtml;
  }
  return plain ? markupToText(plain, true) : null;
}
