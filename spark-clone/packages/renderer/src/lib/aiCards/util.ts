import type { MessageMeta } from '@app/shared';
import { useAssistant } from '../../state/assistant';
import { api } from '../api';
import { urlsIn, parseJson } from './text';

export * from './text';

const JSON_RULE =
  '\n\nAnswer with one JSON object only: no prose before or after it, no Markdown code fence.';

/** One-shot Claude call that answers with JSON. */
export async function askJson<T>(prompt: string, system: string): Promise<T> {
  const text = await useAssistant.getState().complete(prompt, system + JSON_RULE);
  return parseJson<T>(text);
}

export interface LinkedText {
  text: string;
  links: { text: string; url: string }[];
}

/** HTML to readable text, with each link written as `label <url>` and listed. */
export function htmlToLinkedText(html: string): LinkedText {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('style,script,head,title').forEach((n) => n.remove());
  const links: { text: string; url: string }[] = [];
  doc.querySelectorAll('a[href]').forEach((a) => {
    const url = a.getAttribute('href') ?? '';
    if (!/^https?:\/\//i.test(url)) return;
    const text = (a.textContent ?? '').replace(/\s+/g, ' ').trim();
    links.push({ text, url });
    a.textContent = text ? `${text} <${url}>` : `<${url}>`;
  });
  doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  doc.querySelectorAll('p,div,li,tr,h1,h2,h3,h4,td').forEach((el) => el.append('\n'));
  const text = (doc.body?.textContent ?? '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
  return { text, links };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A message's body as linked text. Bodies download lazily: a miss queues the
 * fetch, so wait briefly and ask again before settling for the snippet.
 */
export async function messageText(m: MessageMeta, maxChars: number): Promise<LinkedText> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const body = await api.query('message:body', { messageId: m.id }).catch(() => null);
    if (body?.html) {
      const out = htmlToLinkedText(body.html);
      return { text: out.text.slice(0, maxChars), links: out.links };
    }
    if (body?.text) {
      const text = body.text.slice(0, maxChars);
      return { text, links: urlsIn(body.text).map((url) => ({ text: '', url })) };
    }
    await wait(1200);
  }
  return { text: m.snippet ?? '', links: [] };
}

/** The newest message in a thread that someone else sent (else the newest). */
export async function lastInbound(
  threadId: string,
  mine: Set<string>,
): Promise<MessageMeta | null> {
  const msgs = await api.query('thread:messages', { threadId }).catch(() => [] as MessageMeta[]);
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]!;
    if (!m.draft && !mine.has((m.from?.email ?? '').toLowerCase())) return m;
  }
  return msgs[msgs.length - 1] ?? null;
}

export async function myAddresses(): Promise<Set<string>> {
  const accounts = await api.query('accounts:list', undefined).catch(() => []);
  return new Set(accounts.map((a) => a.email.toLowerCase()));
}
