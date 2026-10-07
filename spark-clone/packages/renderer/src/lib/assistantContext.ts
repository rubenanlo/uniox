import { toast } from 'sonner';
import type { MessageMeta } from '@app/shared';
import { useAssistant } from '../state/assistant';
import { useKanban } from '../state/kanban';
import { useUi } from '../state/store';
import { api } from './api';
import { getComposerAccountId, getDraftText, replaceDraftBody } from './composerBridge';
import { ensureStyleProfile, styleSystem } from './writingStyle';

/** Actions the orb can run; the presentational menu lives in OrbCorner. */
export type AssistantAction =
  | 'summarize-emails'
  | 'summarize-tasks'
  | 'today-events'
  | 'summarize-thread'
  | 'translate-thread'
  | 'reply-thread'
  | 'rewrite-composer'
  | 'formal-composer'
  | 'informal-composer'
  | 'style-composer'
  | 'translate-composer';

/** Composer rewrites: one prompt each, all returning just the new body. */
const COMPOSER_PROMPTS: Partial<Record<AssistantAction, { busy: string; prompt: string }>> = {
  'rewrite-composer': {
    busy: 'Rewriting…',
    prompt:
      'Rewrite this email so it flows well and reads naturally. Keep the meaning and all ' +
      'specifics. Return only the rewritten body.',
  },
  'formal-composer': {
    busy: 'Making it formal…',
    prompt:
      'Rewrite this email in a formal, professional register: courteous greeting and sign-off, ' +
      'no slang or contractions, complete sentences. Keep the meaning, every specific, and the ' +
      "draft's language. Return only the rewritten body.",
  },
  'informal-composer': {
    busy: 'Making it informal…',
    prompt:
      'Rewrite this email in a relaxed, friendly, informal register, the way you would write to a ' +
      "colleague you know well. Keep the meaning, every specific, and the draft's language. " +
      'Return only the rewritten body.',
  },
};

export function stripHtml(html: string): string {
  const el = document.createElement('div');
  el.innerHTML = html;
  return (el.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

async function inboxContext(): Promise<string> {
  const accountId = useUi.getState().accountFilter;
  const threads = await api.query('threads:list', {
    view: 'inbox',
    accountId,
    limit: 40,
    offset: 0,
  });
  const unread = threads.filter((t) => t.unreadCount > 0).slice(0, 20);
  const rows = (unread.length ? unread : threads.slice(0, 15)).map((t) => {
    const who = t.participants[0]?.name || t.participants[0]?.email || 'Unknown';
    return `- ${who} — ${t.subject || '(no subject)'}: ${t.snippet}`;
  });
  return `The user's inbox (${unread.length} unread shown):\n${rows.join('\n') || '(empty)'}`;
}

function kanbanContext(): string {
  const board = useKanban.getState().board;
  if (!board) return 'The Sprint board is not connected, so no tasks are available.';
  const lines = board.columns.flatMap((col) =>
    col.cards.map((c) => `- [${col.status}] ${c.title}${c.dueDate ? ` (due ${c.dueDate})` : ''}`),
  );
  return `The Sprint board tasks:\n${lines.join('\n') || '(no tasks)'}`;
}

async function threadContext(messages?: MessageMeta[]): Promise<string> {
  const threadId = useUi.getState().selectedThreadId;
  if (!threadId) return '';
  const msgs = messages ?? (await api.query('thread:messages', { threadId }));
  const last = msgs[msgs.length - 1];
  if (!last) return '';
  const body = await api.query('message:body', { messageId: last.id });
  const text = body?.text?.trim() || (body?.html ? stripHtml(body.html) : last.snippet);
  const who = last.from?.name || last.from?.email || 'Unknown';
  return `The open email thread "${last.subject || '(no subject)'}", latest message from ${who}:\n\n${text.slice(0, 6000)}`;
}

function requireConfigured(): boolean {
  const a = useAssistant.getState();
  if (a.configured) return true;
  a.refreshStatus();
  toast('Add your Claude API key in Settings to use the assistant.');
  return false;
}

/** Run an orb action: chat actions stream into the modal; compose actions draft. */
export async function runAssistantAction(
  action: AssistantAction,
  opts: { language?: string } = {},
): Promise<void> {
  if (!requireConfigured()) return;
  const a = useAssistant.getState();

  switch (action) {
    case 'summarize-emails': {
      a.setOpen(true);
      a.send('Summarize my new and unread emails, and flag which ones need a reply.', await inboxContext());
      return;
    }
    case 'summarize-tasks': {
      a.setOpen(true);
      a.send('Summarize my Sprint board tasks and what to focus on next.', kanbanContext());
      return;
    }
    case 'today-events': {
      a.setOpen(true);
      a.send(
        'What events do I have today?',
        'Note: this email app has no calendar integration, so you have no access to the ' +
          "user's calendar. Say so plainly and suggest connecting one, rather than inventing events.",
      );
      return;
    }
    case 'summarize-thread': {
      a.setOpen(true);
      a.send('Summarize this email thread and list any action items for me.', await threadContext());
      return;
    }
    case 'translate-thread': {
      a.setOpen(true);
      a.send('Translate this email into English. Preserve formatting and tone.', await threadContext());
      return;
    }
    case 'reply-thread': {
      const threadId = useUi.getState().selectedThreadId;
      if (!threadId) return;
      const msgs = await api.query('thread:messages', { threadId });
      const last = msgs[msgs.length - 1];
      if (!last) return;
      const ctx = await threadContext(msgs);
      toast('Drafting a reply…');
      try {
        const draft = await a.complete(
          'Draft a reply to the latest message in this email thread. Return only the reply body — ' +
            'no subject line, no "[Your name]" placeholders, no preamble.',
          ctx,
        );
        useUi.getState().openComposer({
          mode: 'reply',
          accountId: last.accountId,
          replyTo: last,
          initialBody: draft,
        });
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not draft a reply.');
      }
      return;
    }
    case 'rewrite-composer':
    case 'formal-composer':
    case 'informal-composer': {
      const { busy, prompt } = COMPOSER_PROMPTS[action]!;
      await rewriteDraft(busy, () => a.complete(prompt, `Current draft:\n\n${getDraftText()}`));
      return;
    }
    case 'style-composer': {
      const accountId = getComposerAccountId();
      if (!accountId) return;
      await rewriteDraft('Rewriting in your style…', async () => {
        const profile = await ensureStyleProfile(accountId, a.complete);
        return a.complete(
          "Rewrite this email draft so it reads as if the user wrote it themselves, following their " +
            'writing style below (greeting, sign-off, tone, length, phrasing). Keep the meaning, ' +
            "every specific, and the draft's language. Return only the rewritten body.\n\n" +
            `Current draft:\n\n${getDraftText()}`,
          styleSystem(profile),
        );
      });
      return;
    }
    case 'translate-composer': {
      const language = opts.language?.trim() || 'English';
      await rewriteDraft(`Translating into ${language}…`, () =>
        a.complete(
          `Translate this email into ${language}. Keep the tone and formatting. Return only the ` +
            'translated body.',
          `Current draft:\n\n${getDraftText()}`,
        ),
      );
      return;
    }
  }
}

/** Replace the composer draft with `run()`'s output, with toasts on either end. */
async function rewriteDraft(busy: string, run: () => Promise<string>): Promise<void> {
  if (!getDraftText()) return void toast('Write something first.');
  const id = toast.loading(busy);
  try {
    const out = (await run()).trim();
    if (out) replaceDraftBody(out);
    toast.dismiss(id);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'The assistant could not rewrite the draft.', { id });
  }
}
