import { escapeAndLinkify, sanitizeSignatureHtml } from '@app/email-render';
import { api } from './api';

/** Largest image a signature keeps (pasted, dropped or downloaded). */
export const SIGNATURE_IMAGE_MAX = 2 * 1024 * 1024;

const looksLikeHtml = (s: string) => /<[a-z][\s\S]*>/i.test(s);

/** Plain text (one line per row, links kept clickable) as signature HTML. */
export function textToSignatureHtml(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => `<div>${line.trim() ? escapeAndLinkify(line) : '<br>'}</div>`)
    .join('');
}

/**
 * A stored signature as safe HTML. Signatures saved by the old textarea may be
 * plain text; its line breaks would otherwise collapse into one line.
 */
export function normalizeSignatureHtml(stored: string): string {
  const trimmed = stored.trim();
  if (!trimmed) return '';
  return sanitizeSignatureHtml(looksLikeHtml(trimmed) ? trimmed : textToSignatureHtml(trimmed));
}

/** The signature's text, for the plain-text part of an outgoing message. */
export function signatureText(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  for (const br of Array.from(doc.body.querySelectorAll('br'))) br.replaceWith('\n');
  for (const el of Array.from(doc.body.querySelectorAll('div, p, tr, li, h1, h2, h3, h4'))) {
    el.append('\n');
  }
  for (const cell of Array.from(doc.body.querySelectorAll('td, th'))) cell.append(' ');
  return (doc.body.textContent ?? '')
    .split('\n')
    .map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function fileToDataUri(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const isImageFile = (f: File) => /^image\/(png|jpe?g|gif|webp|bmp|svg\+xml)$/.test(f.type);

export interface PastedSignature {
  html: string;
  /** Images whose pixels the clipboard didn't carry (they were dropped). */
  missingImages: number;
  /** Images over SIGNATURE_IMAGE_MAX (dropped). */
  tooLarge: number;
}

/**
 * Turn whatever was pasted or dropped into self-contained signature HTML:
 * sanitized, with every image stored as a data: URL. Mail clients put a
 * signature's images on the clipboard in different ways: data: URLs (Gmail
 * compose), remote URLs (Gmail settings, websites), or local references
 * (cid:, file:, webkit-fake-url:) with the pixels as separate image files.
 */
export async function importSignatureContent(data: DataTransfer): Promise<PastedSignature> {
  const files = Array.from(data.files).filter(isImageFile);
  const rawHtml = data.getData('text/html');
  const text = data.getData('text/plain');

  let html: string;
  if (rawHtml.trim()) html = rawHtml;
  else if (text.trim()) html = textToSignatureHtml(text);
  else html = '';
  // An image on its own (a screenshot, a logo copied from Preview) or files dropped.
  if (!html && files.length) html = files.map(() => '<img>').join('');

  // sanitizeSignatureHtml removes sources it can't keep (file:, webkit-fake-url:)
  // and leaves those <img> without src: those are filled from clipboard files.
  const doc = new DOMParser().parseFromString(
    `<body>${sanitizeSignatureHtml(html)}</body>`,
    'text/html',
  );
  const queue = [...files];
  let missingImages = 0;
  let tooLarge = 0;
  await Promise.all(
    Array.from(doc.body.querySelectorAll('img')).map(async (img) => {
      const src = img.getAttribute('src') ?? '';
      if (src.startsWith('data:')) {
        if (src.length * 0.75 > SIGNATURE_IMAGE_MAX) {
          tooLarge++;
          img.remove();
        }
        return;
      }
      if (/^https?:/i.test(src)) {
        const res = await api.command('signature:fetch-image', { url: src });
        // Unreachable remote images stay hotlinked: recipients may still load them.
        if (res.ok && res.dataUri) img.setAttribute('src', res.dataUri);
        return;
      }
      const file = queue.shift();
      if (file && file.size <= SIGNATURE_IMAGE_MAX) {
        img.setAttribute('src', await fileToDataUri(file));
        return;
      }
      if (file) tooLarge++;
      else missingImages++;
      img.remove();
    }),
  );
  return { html: doc.body.innerHTML, missingImages, tooLarge };
}
