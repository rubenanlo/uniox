/**
 * The composer styles lists through app.css, but none of that travels with
 * the message: Gmail and most clients fall back to browser defaults (40px
 * list indent, 1em margins on the <p> TipTap wraps around every item), so
 * bullets arrived far more spread out than they looked while writing.
 * Inline the composer's list styles so recipients see what the sender saw.
 */
const LIST_STYLE = 'margin:0 0 0.8em;padding-left:1.5em;';
const NESTED_LIST_STYLE = 'margin:0.25em 0 0;padding-left:1.5em;';
const ITEM_STYLE = 'margin:0 0 0.25em;';
const ITEM_PARAGRAPH_STYLE = 'margin:0;';

function addStyle(el: Element, style: string): void {
  const existing = el.getAttribute('style');
  el.setAttribute('style', existing ? `${style}${existing}` : style);
}

export function inlineEmailStyles(html: string): string {
  if (!/<(ul|ol)\b/i.test(html)) return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  for (const list of doc.body.querySelectorAll('ul, ol')) {
    addStyle(list, list.parentElement?.closest('li') ? NESTED_LIST_STYLE : LIST_STYLE);
  }
  for (const item of doc.body.querySelectorAll('li')) addStyle(item, ITEM_STYLE);
  for (const p of doc.body.querySelectorAll('li > p')) addStyle(p, ITEM_PARAGRAPH_STYLE);
  return doc.body.innerHTML;
}
