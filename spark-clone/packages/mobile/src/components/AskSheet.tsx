import { ArrowUp, ChevronRight } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import type { MobileThread } from '../data/types';
import { firstName } from '../lib/format';
import { go } from '../lib/router';
import { useStore } from '../lib/store';
import { createPortal } from 'react-dom';
import { AiMark } from './ui';
import './ask.css';

const CLEARABLE = new Set(['newsletters', 'notifications', 'promotions']);

/**
 * The orb's Assistant: a short frosted sheet that talks like the Inbox. Each
 * underlined phrase runs that request (AI tokens are only spent on a tap);
 * typing goes to the full Assistant page.
 */
export function AskSheet({
  thread,
  onClose,
}: {
  /** When opened from a conversation, the offer is about that conversation. */
  thread?: MobileThread;
  onClose: () => void;
}) {
  const { api, threads, act, showToast } = useStore();
  const [answer, setAnswer] = useState<{ q: string; body: ReactNode | null } | null>(null);
  const [input, setInput] = useState('');
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const waiting = threads.filter((t) => t.inInbox && t.priority && t.unreadCount > 0);
  const clearable = threads.filter((t) => t.inInbox && !t.priority && CLEARABLE.has(t.category));
  const who = thread ? firstName(thread.lastFrom) : '';

  const ask = (q: string, prompt: string) => {
    setAnswer({ q, body: null });
    api
      .assistant([{ role: 'user', text: prompt }])
      .then((text) => setAnswer({ q, body: <div className="ask-text">{text}</div> }))
      .catch((e) =>
        setAnswer({
          q,
          body: <div className="ask-text">Sorry, that failed: {(e as Error).message}</div>,
        }),
      );
  };
  const showClear = () =>
    setAnswer({
      q: `Find emails I can archive`,
      body: (
        <>
          <div className="ask-text">
            {clearable.length} newsletters, notifications and promotions are sitting in your Inbox.
          </div>
          <div className="ask-acts">
            <button
              onClick={() => {
                for (const t of clearable) void act(t, { kind: 'archive' });
                showToast({ text: `Archived ${clearable.length} emails` });
                onClose();
              }}
            >
              Archive all {clearable.length}
            </button>
          </div>
        </>
      ),
    });

  const W = ({ children, run }: { children: ReactNode; run: () => void }) => (
    <button className="w" onClick={run}>
      {children}
    </button>
  );
  const subj = thread ? `“${thread.subject || '(no subject)'}”` : '';

  return createPortal(
    <div className="sheet-wrap ask-wrap">
      <div className="scrim" onClick={onClose} />
      <div className="sheet ask-sheet glass" role="dialog" aria-label="Assistant">
        <div className="grab" />
        <div className="ask-mini">
          <AiMark size={22} />
          Assistant
        </div>
        {!answer ? (
          <p className="ask-sent">
            {thread ? (
              <>
                I can{' '}
                <W
                  run={() =>
                    ask(
                      'Sum up this conversation',
                      `Sum up the email conversation ${subj} in two sentences.`,
                    )
                  }
                >
                  sum up
                </W>{' '}
                {thread.messageCount > 1 ? `these ${thread.messageCount} messages` : 'this email'},{' '}
                <W run={() => go(`compose?reply=${encodeURIComponent(thread.id)}&ai=1`)}>
                  draft a reply
                </W>
                {who ? ` to ${who}` : ''}, or{' '}
                <W run={() => go(`compose?reply=${encodeURIComponent(thread.id)}&times=1`)}>
                  find a time
                </W>{' '}
                you’re both free.
              </>
            ) : (
              <>
                I can{' '}
                <W
                  run={() =>
                    ask(
                      'Sum up who is waiting',
                      'Sum up the priority emails waiting on my reply, one line per person.',
                    )
                  }
                >
                  sum up
                </W>{' '}
                the {waiting.length} {waiting.length === 1 ? 'person' : 'people'} waiting,{' '}
                <W
                  run={() =>
                    ask(
                      'Draft my replies',
                      'Draft short replies to the priority emails waiting on me.',
                    )
                  }
                >
                  draft {waiting.length || ''} {waiting.length === 1 ? 'reply' : 'replies'}
                </W>
                , or find <W run={showClear}>{clearable.length} emails</W> you can archive.
              </>
            )}
          </p>
        ) : (
          <div className="ask-ans">
            <span className="ask-q">“{answer.q}”</span>
            {answer.body ?? (
              <div className="ask-think" aria-label="Thinking">
                <i />
                <i />
                <i />
              </div>
            )}
          </div>
        )}
        <form
          className="ask-foot"
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) go(`assistant?q=${encodeURIComponent(input.trim())}`);
          }}
        >
          <input
            placeholder="Ask anything…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button className="send" disabled={!input.trim()} aria-label="Ask">
            <ArrowUp size={18} />
          </button>
        </form>
        <button className="ask-full" onClick={() => go('assistant')}>
          Open the full Assistant <ChevronRight size={14} />
        </button>
      </div>
    </div>,
    document.body,
  );
}
