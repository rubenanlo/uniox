import { toast } from 'sonner';
import type { MessageMeta } from '@app/shared';
import { useAssistant } from '../state/assistant';
import { useKanban } from '../state/kanban';
import { useUi } from '../state/store';
import { api } from './api';
import { getDraftText, replaceDraftBody } from './composerBridge';

/** Actions the orb can run; the presentational menu lives in OrbCorner. */
export type AssistantAction =
  | 'summarize-emails'
  | 'summarize-tasks'
  | 'today-events'
  | 'summarize-thread'
  | 'translate-thread'
  | 'reply-thread'
  | 'rewrite-composer'
  | 'translate-composer';

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
export async function runAssistantAction(action: AssistantAction): Promise<void> {
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
    case 'rewrite-composer': {
      const draft = getDraftText();
      if (!draft) return void toast('Write something first, then rewrite it.');
      toast('Rewriting…');
      try {
        const out = await a.complete(
          'Rewrite this email so it flows well and reads naturally. Keep the meaning and all ' +
            'specifics. Return only the rewritten body.',
          `Current draft:\n\n${draft}`,
        );
        replaceDraftBody(out);
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not rewrite the draft.');
      }
      return;
    }
    case 'translate-composer': {
      const draft = getDraftText();
      if (!draft) return void toast('Write something first, then translate it.');
      toast('Translating…');
      try {
        const out = await a.complete(
          'Translate this email into English. Return only the translated body.',
          `Current draft:\n\n${draft}`,
        );
        replaceDraftBody(out);
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not translate the draft.');
      }
      return;
    }
  }
}
