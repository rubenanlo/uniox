import DOMPurify from 'dompurify';

/**
 * Signatures are pasted from other mail clients, Word or web pages, then
 * rendered straight into the app window (the settings editor) and sent to
 * every recipient. Keep what makes a signature look right (tables, inline
 * fonts/colors/sizes, links, images) and drop anything active or anything
 * that could overlay the UI or phone home.
 */
const SIGNATURE_FORBID_TAGS = [
  'script',
  'style',
  'head',
  'title',
  'meta',
  'link',
  'base',
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
  'audio',
  'video',
  'svg',
  'math',
  'template',
  'noscript',
  'canvas',
  'dialog',
];

const SAFE_HREF = /^\s*(?:https?:|mailto:|tel:)/i;
/** Raster/vector images only: these are the only data: URLs a signature keeps. */
const DATA_IMAGE = /^\s*data:image\/(?:png|jpe?g|gif|webp|bmp|svg\+xml);base64,[a-z0-9+/=\s]+$/i;
const REMOTE = /^\s*https?:/i;

/** CSS that could cover the app chrome or load something from a stylesheet. */
const BLOCKED_PROPS = /^(?:position|z-index|behavior|-moz-binding|content|cursor|pointer-events)$/i;

function cleanStyle(style: string): string {
  return style
    .split(';')
    .map((d) => d.trim())
    .filter((d) => {
      const colon = d.indexOf(':');
      if (colon <= 0) return false;
      const prop = d.slice(0, colon).trim();
      const value = d.slice(colon + 1);
      if (BLOCKED_PROPS.test(prop) || prop.startsWith('mso-')) return false;
      if (/expression\s*\(|javascript:/i.test(value)) return false;
      // url() only for inline data images (a background in a table cell).
      if (/url\(/i.test(value) && !/url\(\s*['"]?data:image\//i.test(value)) return false;
      return true;
    })
    .join('; ');
}

export function sanitizeSignatureHtml(dirty: string): string {
  const clean = DOMPurify.sanitize(dirty, {
    FORBID_TAGS: SIGNATURE_FORBID_TAGS,
    FORBID_ATTR: [
      'srcdoc',
      'formaction',
      'action',
      'id',
      'class',
      'srcset',
      'background',
      'contenteditable',
    ],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|cid|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    WHOLE_DOCUMENT: false,
  });
  const doc = new DOMParser().parseFromString(`<div id="root">${clean}</div>`, 'text/html');
  const root = doc.getElementById('root')!;

  // Word/Outlook paste leaves comments (conditional comments, StartFragment).
  const walker = doc.createTreeWalker(root, 128 /* NodeFilter.SHOW_COMMENT */);
  const comments: Node[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  for (const c of comments) c.parentNode?.removeChild(c);

  for (const a of Array.from(root.querySelectorAll('a'))) {
    const href = a.getAttribute('href') ?? '';
    if (!SAFE_HREF.test(href)) a.removeAttribute('href');
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noreferrer noopener');
  }
  // Images keep data:, http(s): and cid: sources here; the editor resolves
  // the last two into stored data: images before saving.
  for (const img of Array.from(root.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? '';
    if (!(DATA_IMAGE.test(src) || REMOTE.test(src) || /^\s*cid:/i.test(src))) {
      img.removeAttribute('src');
    }
  }
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[style]'))) {
    const style = cleanStyle(el.getAttribute('style') ?? '');
    if (style) el.setAttribute('style', style);
    else el.removeAttribute('style');
  }
  // Word and Outlook zero paragraph margins in a <style> block, which is
  // dropped above and by most recipients' clients: keep lines tight inline.
  for (const p of Array.from(root.querySelectorAll<HTMLElement>('p'))) {
    if (!/(^|;)\s*margin/i.test(p.getAttribute('style') ?? '')) {
      const style = p.getAttribute('style');
      p.setAttribute('style', style ? `margin:0; ${style}` : 'margin:0');
    }
  }
  return root.innerHTML.trim();
}
