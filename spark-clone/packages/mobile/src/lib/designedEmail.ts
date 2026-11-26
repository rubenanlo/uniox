/**
 * Is this a "designed" email (newsletter, shipping notice, receipt) whose
 * HTML layout is the message, or a conversation that reads fine as a chat
 * bubble? Designed mail is built from layout tables, a <style> sheet and
 * images; a person's mail is a few divs, maybe a signature table, plus quoted
 * history. DOM-free so it runs in tests.
 */

/** Where the quoted history starts in a reply (Gmail, Outlook, Apple Mail). */
const QUOTE_START =
  /<div[^>]+class=["'][^"']*gmail_quote|<div[^>]+id=["']?(?:divRplyFwdMsg|appendonsend)|<blockquote\b|<hr[^>]+id=["']?stopSpelling/i;

function count(s: string, re: RegExp): number {
  return (s.match(re) ?? []).length;
}

export function isDesignedEmail(html: string | null | undefined): boolean {
  if (!html || html.length < 400) return false;
  const q = html.search(QUOTE_START);
  const own = q >= 0 ? html.slice(0, q) : html;
  const tables = count(own, /<table\b/gi);
  const imgs = count(own, /<img\b/gi);
  const style = /<style\b/i.test(own);
  // Outlook writes every message with a <style> sheet (MsoNormal) and often
  // a table or two for the signature, so it needs a real layout to count.
  const outlook = /class=["']?MsoNormal/i.test(own);
  if (outlook) return tables >= 6;
  if (tables >= 3) return true;
  if (style && (tables >= 1 || imgs >= 2)) return true;
  return imgs >= 4;
}
