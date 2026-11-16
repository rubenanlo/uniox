import type { MessageBodyPayload, MessageMeta } from '@app/shared';
import { useAssistant } from '../state/assistant';
import { COMPOSER_PROMPTS, stripHtml, type AssistantAction } from './assistantContext';
import { parseReplyIdeas, visibleText, type ReplyIdeas } from './quickReply';
import { ensureStyleProfile, styleSystem } from './writingStyle';

/** The draft rewrites the widget's AI menu offers (the composer's own set). */
export type DraftRewrite = 'rewrite-composer' | 'style-composer' | 'formal-composer' | 'informal-composer' | 'translate-composer';

/** Plain text of one message's new part. */
export function messageVisibleText(body: MessageBodyPayload | undefined, fallback: string): string {
  const raw = body?.text?.trim() || (body?.html ? stripHtml(body.html) : '') || fallback;
  return visibleText(raw);
}

/** The thread as the assistant reads it: the last few messages, oldest first. */
export function threadContext(
  messages: MessageMeta[],
  bodies: Record<string, MessageBodyPayload>,
  ownEmails: Set<string>,
): string {
  const recent = messages.slice(-5);
  const parts = recent.map((m) => {
    const mine = !!m.from && ownEmails.has(m.from.email.toLowerCase());
    const who = mine ? 'Me' : m.from?.name || m.from?.email || 'Unknown';
    const to = m.to.map((a) => a.name || a.email).join(', ');
    return `From: ${who}${to ? `\nTo: ${to}` : ''}\nDate: ${new Date(m.date).toISOString()}\n\n${messageVisibleText(
      bodies[m.id],
      m.snippet,
    ).slice(0, 4000)}`;
  });
  const subject = messages[messages.length - 1]?.subject || '(no subject)';
  return `An email thread, subject "${subject}". "Me" is the user.\n\n${parts.join('\n\n---\n\n')}`;
}

/** The opening summary, up to three reply ideas, and a forward when one is asked for. */
export async function replyIdeas(context: string): Promise<ReplyIdeas> {
  const raw = await useAssistant
    .getState()
    .complete(
      'Read the latest message in this thread, written to me. Reply with JSON only, no prose: ' +
        '{"summary": string, "suggestions": string[], "forwardTo": {"name": string, "email": string} | null, ' +
        '"meetingMinutes": number | null}. ' +
        'summary: one or two short sentences on what the sender wants from me, addressed to me ("Maya wants…"). ' +
        'suggestions: up to 3 distinct replies I might send, each a 2–5 word intent in my voice ' +
        '("Accept Tuesday", "Ask for the agenda", "Decline politely"); [] when no reply is needed. ' +
        'forwardTo: when the email asks me to forward or send something to a specific person whose ' +
        'address appears in the thread, that person; else null. meetingMinutes: when the email asks ' +
        'me for my availability or to agree on a time to meet or talk, the meeting length it asks for ' +
        '(30 when unstated); else null. Use the language of the email.',
      context,
    );
  return parseReplyIdeas(raw);
}

/** A full reply body from a short intent (a chip) and any picked times. */
export function draftFromIntent(context: string, intent: string, timeLines: string[]): Promise<string> {
  const times = timeLines.length
    ? `\n\nOffer ${timeLines.length > 1 ? 'these times, one per line with "• ", and ask which works' : 'this time'}, copied exactly:\n${timeLines.join('\n')}`
    : '';
  return useAssistant
    .getState()
    .complete(
      `Write my reply to the latest message in this thread. What I want to say: "${intent}".${times}\n\n` +
        "Match the thread's language, tone and formality. Greet the sender by first name (or everyone " +
        'if several people are on it). Keep it short. Return only the body: no subject, no ' +
        'signature, no placeholders, no preamble.',
      context,
    )
    .then((s) => s.trim());
}

/** Rewrite the typed draft with one of the composer's AI options. */
export async function rewriteDraft(
  kind: DraftRewrite,
  draft: string,
  accountId: string,
  language?: string,
): Promise<string> {
  const a = useAssistant.getState();
  const current = `Current draft:\n\n${draft}`;
  if (kind === 'style-composer') {
    const profile = await ensureStyleProfile(accountId, a.complete);
    return (
      await a.complete(
        'Rewrite this email draft so it reads as if the user wrote it themselves, following their ' +
          'writing style below (greeting, sign-off, tone, length, phrasing). Keep the meaning, ' +
          "every specific, and the draft's language. Return only the rewritten body.\n\n" +
          current,
        styleSystem(profile),
      )
    ).trim();
  }
  if (kind === 'translate-composer') {
    const to = language?.trim() || 'English';
    return (
      await a.complete(`Translate this email into ${to}. Keep the tone and formatting. Return only the translated body.`, current)
    ).trim();
  }
  const prompt = COMPOSER_PROMPTS[kind as AssistantAction]!.prompt;
  return (await a.complete(prompt, current)).trim();
}

/** A free question about the thread ("When did they first ask?"), answered briefly. */
export function askAbout(context: string, question: string): Promise<string> {
  return useAssistant
    .getState()
    .complete(`${question}\n\nAnswer briefly, from the thread only.`, context)
    .then((s) => s.trim());
}

export function summarizeThread(context: string): Promise<string> {
  return useAssistant
    .getState()
    .complete('Summarize this email thread in 2–4 short bullet points, then list anything I need to do.', context)
    .then((s) => s.trim());
}
