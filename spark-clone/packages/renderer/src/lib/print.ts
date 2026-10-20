import type { Address } from '@app/shared';
import { buildPrintDocument, sanitizeEmailHtml, textToHtml } from '@app/email-render';
import { toast } from 'sonner';
import { api } from './api';

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

const addr = (a: Address) => (a.name ? `${a.name} <${a.email}>` : a.email);

/**
 * ⌘P / the reader's print button: every sent or received message of the
 * thread (drafts stay out), light theme, remote images loaded and quoted
 * history unfolded so the paper copy shows the whole email.
 */
export async function printThread(threadId: string): Promise<void> {
  const [thread, messages] = await Promise.all([
    api.query('thread:get', { threadId }),
    api.query('thread:messages', { threadId }),
  ]);
  const mail = messages.filter((m) => !m.draft);
  if (!mail.length) return;
  const bodies = await Promise.all(mail.map((m) => api.query('message:body', { messageId: m.id })));
  const doc = buildPrintDocument(
    thread?.subject ?? mail[mail.length - 1]!.subject,
    mail.map((m, i) => {
      const body = bodies[i];
      const source =
        body?.html ??
        (body?.text ? textToHtml(body.text) : textToHtml(m.snippet || '(empty message)'));
      const { html } = sanitizeEmailHtml(source, {
        allowRemoteImages: true,
        attachments: body?.attachments ?? [],
        foldQuotes: false,
      });
      return {
        from: m.from ? addr(m.from) : 'Unknown',
        to: m.to.map(addr).join(', '),
        cc: m.cc.map(addr).join(', '),
        date: fmtDate(m.date),
        html,
      };
    }),
  );
  const result = await api.command('print:thread', {
    html: doc,
    title: thread?.subject ?? 'Email',
  });
  if (!result.ok) toast(`Couldn’t print: ${result.error ?? 'unknown error'}`);
}
