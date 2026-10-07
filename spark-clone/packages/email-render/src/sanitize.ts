import DOMPurify from 'dompurify';
import type { AttachmentMeta } from '@app/shared';

export interface SanitizeOptions {
  /** Load remote http(s) images. Default false: they are neutralized and counted. */
  allowRemoteImages?: boolean;
  /** cid: URLs resolve against these attachments (localPath → app:// URL). */
  attachments?: AttachmentMeta[];
  /**
   * Rendering on a dark background: strip hardcoded dark text colors that
   * have no explicit light background of their own (Outlook's `black` /
   * `windowtext` replies), so the theme's light foreground applies instead.
   */
  darkMode?: boolean;
}

export interface SanitizeResult {
  html: string;
  blockedImages: number;
  /**
   * Normalized cids the html actually references as inline images. Gmail
   * assigns a Content-ID to every attachment (real files included), so a cid
   * alone doesn't make an attachment inline — only appearing here does.
   */
  inlineCids: string[];
}

const FORBID_TAGS = [
  'script',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'form',
  'input',
  'textarea',
  'select',
  'button',
  'base',
  'meta',
  'link',
  'audio',
  'video',
];

const REMOTE_URL = /^\s*https?:/i;

export function attachmentUrl(att: AttachmentMeta): string {
  // Served by the main process app:// protocol, path-validated there.
  return `app://attachments/${encodeURI(att.localPath ?? '')}`;
}

/**
 * Email HTML is hostile input (report §8.1). DOMPurify here is one layer;
 * the sandboxed iframe with script-src 'none' (buildSrcdoc) is the boundary.
 */
export function sanitizeEmailHtml(dirty: string, opts: SanitizeOptions = {}): SanitizeResult {
  let blockedImages = 0;
  const byCid = new Map<string, AttachmentMeta>();
  for (const a of opts.attachments ?? []) {
    if (a.cid) byCid.set(a.cid.replace(/^<|>$/g, ''), a);
  }

  const clean = DOMPurify.sanitize(dirty, {
    FORBID_TAGS,
    FORBID_ATTR: ['srcdoc', 'formaction', 'action'],
    ALLOW_UNKNOWN_PROTOCOLS: false,
    ADD_ATTR: ['target'],
    // cid: for inline images; app: is our attachment protocol.
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|cid|app|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
    WHOLE_DOCUMENT: false,
  });

  const doc = new DOMParser().parseFromString(`<div id="root">${clean}</div>`, 'text/html');
  const root = doc.getElementById('root')!;

  // Resolve cid: images; block remote images unless allowed.
  const inlineCids = new Set<string>();
  for (const img of Array.from(root.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? '';
    if (src.toLowerCase().startsWith('cid:')) {
      const key = src.slice(4).replace(/^<|>$/g, '');
      const att = byCid.get(key);
      if (att) inlineCids.add(key);
      if (att?.localPath) img.setAttribute('src', attachmentUrl(att));
      else img.removeAttribute('src');
      continue;
    }
    if (REMOTE_URL.test(src) && !opts.allowRemoteImages) {
      blockedImages += 1;
      img.setAttribute('data-blocked-src', src);
      img.removeAttribute('src');
      img.setAttribute('alt', img.getAttribute('alt') || '');
      img.style.background = 'rgba(127,127,127,0.15)';
    }
    const srcset = img.getAttribute('srcset');
    if (srcset && !opts.allowRemoteImages) {
      img.removeAttribute('srcset');
    }
  }

  // background= attributes and inline style url(...) can also phone home.
  if (!opts.allowRemoteImages) {
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('[background]'))) {
      const bg = el.getAttribute('background') ?? '';
      if (REMOTE_URL.test(bg)) {
        el.removeAttribute('background');
        blockedImages += 1;
      }
    }
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('[style]'))) {
      const style = el.getAttribute('style') ?? '';
      if (/url\(\s*['"]?\s*https?:/i.test(style)) {
        el.setAttribute('style', style.replace(/url\(\s*['"]?\s*https?:[^)]*\)/gi, 'none'));
        blockedImages += 1;
      }
    }
    for (const styleEl of Array.from(root.querySelectorAll('style'))) {
      const css = styleEl.textContent ?? '';
      if (/url\(\s*['"]?\s*https?:/i.test(css)) {
        styleEl.textContent = css.replace(/url\(\s*['"]?\s*https?:[^)]*\)/gi, 'none');
        blockedImages += 1;
      }
    }
  }

  if (opts.darkMode) adaptDarkText(root);

  // Every link opens externally (the host intercepts and gates it).
  for (const a of Array.from(root.querySelectorAll('a'))) {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noreferrer noopener');
  }

  // Quote folding: collapse trailing quoted history into a native <details>.
  foldQuotes(root);

  return { html: root.innerHTML, blockedImages, inlineCids: [...inlineCids] };
}

/** [r, g, b] for hex/rgb()/black/windowtext colors; null when unparseable. */
function parseColor(value: string): [number, number, number] | null {
  const v = value.trim().toLowerCase();
  if (v === 'black' || v === 'windowtext') return [0, 0, 0];
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(v);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

const luminance = ([r, g, b]: [number, number, number]) =>
  (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

const isDark = (v: string) => {
  const c = parseColor(v);
  return c !== null && luminance(c) < 0.35;
};

/** The nearest explicit background set by the email itself, if any. */
function explicitBg(el: Element, root: Element): string | null {
  for (let n: Element | null = el; n && n !== root; n = n.parentElement) {
    const bg =
      (n as HTMLElement).style?.backgroundColor || n.getAttribute('bgcolor') || '';
    if (bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\s*\)/.test(bg)) return bg;
  }
  return null;
}

/**
 * Dark-mode adaptation (the Apple Mail approach, simplified): hardcoded dark
 * text with no explicit light canvas of its own would render dark-on-dark, so
 * drop the color and let the theme's light foreground take over. Text sitting
 * on a background the email explicitly painted is left exactly as designed.
 */
function adaptDarkText(root: HTMLElement) {
  const keepsOwnCanvas = (el: Element) => {
    const bg = explicitBg(el, root);
    return bg !== null && !isDark(bg); // light canvas: dark text is readable
  };
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[style]'))) {
    const color = el.style.color;
    if (color && isDark(color) && !keepsOwnCanvas(el)) el.style.color = '';
  }
  for (const font of Array.from(root.querySelectorAll('font[color]'))) {
    const color = font.getAttribute('color') ?? '';
    if (isDark(color) && !keepsOwnCanvas(font)) font.removeAttribute('color');
  }
  // <style> blocks need no handling: DOMPurify strips them entirely, so only
  // inline styles and legacy color/bgcolor attributes ever reach the reader.
}

/**
 * Fold the trailing quote chain (gmail_quote / blockquote cite / "On … wrote:")
 * into a <details> so the thread reads clean. No scripts needed in the iframe.
 */
function foldQuotes(root: HTMLElement) {
  const candidates = Array.from(
    root.querySelectorAll('blockquote, .gmail_quote, .quoted, [type="cite"]'),
  ).filter((el) => {
    // only fold top-level-ish trailing quotes, not short inline ones
    const textLen = (el.textContent ?? '').trim().length;
    return textLen > 40 && !el.closest('details');
  });
  for (const q of candidates) {
    const doc = q.ownerDocument;
    const details = doc.createElement('details');
    details.setAttribute('class', 'quote-fold');
    const summary = doc.createElement('summary');
    summary.textContent = '•••';
    details.appendChild(summary);
    q.replaceWith(details);
    details.appendChild(q);
  }
}
