/**
 * Wrap sanitized email HTML in the full srcdoc document. The contract
 * (report §8.1): sandbox never includes allow-scripts; a CSP inside the
 * document duplicates the no-JS guarantee; <base target="_blank"> so links
 * never navigate the frame; readable max-width column (deliberate
 * improvement over Spark's full-width stretch).
 */

/** The only sandbox value ever allowed on the mail iframe. */
export const IFRAME_SANDBOX = 'allow-popups allow-popups-to-escape-sandbox allow-same-origin';

export interface SrcdocOptions {
  allowRemoteImages?: boolean;
  dark?: boolean;
}

export function buildSrcdoc(sanitizedHtml: string, opts: SrcdocOptions = {}): string {
  const imgSrc = opts.allowRemoteImages ? "img-src 'self' app: data: https: http:" : "img-src 'self' app: data:";
  const csp = `default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; ${imgSrc}; font-src data:;`;
  const fg = opts.dark ? '#e7e7ea' : '#1c1c1f';
  const linkColor = opts.dark ? '#8ab4ff' : '#1a56c8';
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<base target="_blank">
<style>
  :root { color-scheme: ${opts.dark ? 'dark' : 'light'}; }
  html, body { margin: 0; padding: 0; background: transparent; }
  body {
    font: 14px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: ${fg};
    /* 16px gutter matches the card header's px-4 grid; the column stays
       left-aligned with the sender line rather than centering. */
    max-width: 640px;
    margin: 0;
    padding: 10px 16px 16px;
    word-wrap: break-word;
    overflow-wrap: anywhere;
  }
  body > :first-child { margin-top: 0; }
  body > :last-child { margin-bottom: 0; }
  p { margin: 0 0 0.8em; }
  h1, h2, h3, h4 { line-height: 1.3; margin: 1.1em 0 0.4em; }
  h1 { font-size: 19px; } h2 { font-size: 16px; } h3, h4 { font-size: 14px; }
  ul, ol { margin: 0 0 0.8em; padding-left: 1.5em; }
  li { margin-bottom: 0.25em; }
  hr { border: none; border-top: 1px solid rgba(127,127,127,.3); margin: 14px 0; }
  img { max-width: 100%; height: auto; }
  img[data-blocked-src] { min-width: 24px; min-height: 24px; border: 1px dashed rgba(127,127,127,.5); }
  table { max-width: 100% !important; }
  code, pre { font: 12px/1.55 ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace; }
  pre { white-space: pre-wrap; background: rgba(127,127,127,.12); border-radius: 8px; padding: 10px 12px; margin: 0 0 0.8em; }
  code { background: rgba(127,127,127,.12); border-radius: 4px; padding: 1px 4px; }
  pre code { background: none; padding: 0; }
  a { color: ${linkColor}; text-underline-offset: 2px; }
  details.quote-fold { margin-top: 8px; }
  details.quote-fold > summary {
    cursor: pointer; list-style: none; display: inline-block;
    padding: 0 10px; border-radius: 8px; background: rgba(127,127,127,.18);
    color: inherit; font-weight: 700; letter-spacing: 2px; user-select: none;
  }
  details.quote-fold > summary::-webkit-details-marker { display: none; }
  blockquote { margin: 8px 0 8px 4px; padding-left: 12px; border-left: 3px solid rgba(127,127,127,.4); }
</style>
</head>
<body>${sanitizedHtml}</body>
</html>`;
}

/** Plain-text fallback rendering. */
export function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const linked = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noreferrer noopener">$1</a>',
  );
  // background/padding:none: the shared pre style renders code blocks, and a
  // plain-text letter must not read as one.
  return `<pre style="white-space:pre-wrap;font:inherit;margin:0;background:none;padding:0">${linked}</pre>`;
}
