/**
 * The printable document for a conversation (⌘P). Bodies arrive already
 * sanitized; the main process loads this into a hidden window with JavaScript
 * disabled, and the CSP below repeats the no-script guarantee. Always light:
 * paper is white whatever the app theme.
 */

export interface PrintMessage {
  from: string;
  to: string;
  cc: string;
  date: string;
  /** Sanitized body HTML (quotes left unfolded so nothing is hidden on paper). */
  html: string;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildPrintDocument(subject: string, messages: PrintMessage[]): string {
  const csp =
    "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src app: data: https: http:; font-src data:;";
  const header = (m: PrintMessage) => `
    <header class="meta">
      <div class="row"><span class="from">${escapeHtml(m.from)}</span><span class="date">${escapeHtml(m.date)}</span></div>
      ${m.to ? `<div class="row small"><span class="label">To</span>${escapeHtml(m.to)}</div>` : ''}
      ${m.cc ? `<div class="row small"><span class="label">Cc</span>${escapeHtml(m.cc)}</div>` : ''}
    </header>`;
  const body = messages
    .map((m) => `<article class="message">${header(m)}<div class="body">${m.html}</div></article>`)
    .join('\n');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>${escapeHtml(subject)}</title>
<style>
  :root { color-scheme: light; }
  @page { margin: 16mm 14mm; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    font: 12.5px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #1c1c1f;
    word-wrap: break-word;
    overflow-wrap: anywhere;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  h1.subject { font-size: 18px; line-height: 1.3; margin: 0 0 14px; }
  .message { padding: 12px 0 18px; border-top: 1px solid #d9d9de; }
  .message + .message { break-before: auto; }
  .meta { margin-bottom: 12px; break-inside: avoid; break-after: avoid; }
  .meta .row { display: flex; gap: 12px; justify-content: space-between; }
  .meta .row.small { justify-content: flex-start; gap: 6px; color: #55555c; font-size: 11.5px; }
  .meta .from { font-weight: 700; }
  .meta .date { color: #55555c; font-size: 11.5px; white-space: nowrap; }
  .meta .label { color: #8a8a92; min-width: 18px; }
  .body > :first-child { margin-top: 0; }
  p { margin: 0 0 0.8em; }
  img { max-width: 100%; height: auto; break-inside: avoid; }
  table { max-width: 100% !important; }
  tr, img { page-break-inside: avoid; }
  pre { white-space: pre-wrap; }
  code, pre { font: 11px/1.5 ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
  a { color: #1a56c8; }
  blockquote { margin: 8px 0 8px 4px; padding-left: 12px; border-left: 3px solid #c9c9cf; }
  details > summary { display: none; }
</style>
</head>
<body>
<h1 class="subject">${escapeHtml(subject || '(no subject)')}</h1>
${body}
</body>
</html>`;
}
