/** What a mailto: link asks for, ready to seed a new-message composer. */
export interface MailtoDraft {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
}

/** Comma-separated address list (RFC 6068), percent-decoded, blanks dropped. */
function addresses(raw: string): string[] {
  return raw
    .split(',')
    .map((a) => safeDecode(a).trim())
    .filter(Boolean);
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Parse a mailto: URL (RFC 6068): `mailto:a@x.com,b@y.com?cc=…&subject=…&body=…`.
 * Header names are case-insensitive and repeated `to`/`cc`/`bcc` accumulate.
 * Returns null for anything that is not a mailto: link.
 */
export function parseMailto(url: string): MailtoDraft | null {
  if (typeof url !== 'string' || !/^mailto:/i.test(url.trim())) return null;
  const rest = url.trim().slice('mailto:'.length);
  const q = rest.indexOf('?');
  const path = q === -1 ? rest : rest.slice(0, q);
  const query = q === -1 ? '' : rest.slice(q + 1);
  const draft: MailtoDraft = { to: addresses(path), cc: [], bcc: [], subject: '', body: '' };
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = safeDecode(eq === -1 ? pair : pair.slice(0, eq)).toLowerCase();
    // `+` is a literal plus in mailto (not a space, unlike form encoding).
    const value = eq === -1 ? '' : pair.slice(eq + 1);
    if (key === 'to' || key === 'cc' || key === 'bcc') draft[key].push(...addresses(value));
    else if (key === 'subject') draft.subject = safeDecode(value);
    else if (key === 'body') draft.body = safeDecode(value).replace(/\r\n/g, '\n');
  }
  return draft;
}
