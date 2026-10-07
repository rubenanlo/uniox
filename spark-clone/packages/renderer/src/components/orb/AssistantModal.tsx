import { ArrowDown, ArrowUp, Settings2, SquarePen, Square, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { runAssistantAction, type AssistantAction } from '../../lib/assistantContext';
import { cn } from '../../lib/utils';
import { useAssistant } from '../../state/assistant';
import { useUi } from '../../state/store';

// Streaming feel: ease the visible cut toward the target so bursts of tokens
// reveal at a steady, readable pace instead of snapping in chunks.
const CATCH_UP_MS = 180;
const FLOOR_CPS = 45;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  return reduced;
}

function lastWordBoundary(source: string, cut: number): number {
  if (cut >= source.length) return source.length;
  const i = source.lastIndexOf(' ', cut);
  return i === -1 ? 0 : i;
}

/** Ease a growing `target` into view, snapping to full once `streaming` ends. */
function useSmoothedText(target: string, streaming: boolean, reduced: boolean): string {
  const [shown, setShown] = useState('');
  const shownRef = useRef(0);
  const targetRef = useRef(target);
  const streamingRef = useRef(streaming);

  // Keep the loop's inputs current without restarting it every token.
  useEffect(() => {
    targetRef.current = target;
    streamingRef.current = streaming;
  });

  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(now - last, 64);
      last = now;
      const tgt = targetRef.current;
      const behind = tgt.length - shownRef.current;
      if (behind > 0) {
        shownRef.current = Math.min(
          tgt.length,
          shownRef.current + behind * (1 - Math.exp(-dt / CATCH_UP_MS)) + (FLOOR_CPS * dt) / 1000,
        );
      }
      const cut = Math.floor(shownRef.current);
      const finished = !streamingRef.current && cut >= tgt.length;
      const safe = finished ? tgt.length : lastWordBoundary(tgt, cut);
      setShown((prev) => (prev.length === safe ? prev : tgt.slice(0, safe)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  return reduced ? target : shown;
}

/** Render text word-by-word so freshly-revealed words ease in (see app.css). */
function StreamingWords({ text, reduced }: { text: string; reduced: boolean }) {
  if (reduced) return <>{text}</>;
  const words = text.match(/\S+\s*/g) ?? [];
  return (
    <>
      {words.map((word, i) => (
        <span key={i} className="assistant-word">
          {word}
        </span>
      ))}
    </>
  );
}

function StreamingMessage({
  text,
  streaming,
  reduced,
}: {
  text: string;
  streaming: boolean;
  reduced: boolean;
}) {
  const shown = useSmoothedText(text, streaming, reduced);
  return <StreamingWords text={shown} reduced={reduced} />;
}

/** Soft top/bottom fades that appear only when the transcript overflows. */
function useScrollFade(ref: RefObject<HTMLDivElement | null>) {
  const [edges, setEdges] = useState({ start: false, end: false });
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    setEdges({
      start: scrollTop > 1,
      end: Math.ceil(scrollTop + clientHeight) < scrollHeight - 1,
    });
  }, [ref]);
  useEffect(() => {
    update();
    const el = ref.current;
    if (!el || !window.ResizeObserver) return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [ref, update]);
  return { edges, onScroll: update };
}

/** Keep the transcript pinned to the newest text unless the user scrolls up. */
function useStickToBottom(ref: RefObject<HTMLDivElement | null>) {
  const stick = useRef(true);
  const [showJump, setShowJump] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      const overflowing = el.scrollHeight - el.clientHeight > 1;
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const atBottom = !overflowing || distance < 24;
      stick.current = atBottom;
      setShowJump(overflowing && !atBottom);
    };
    const onIntent = (e: WheelEvent | TouchEvent) => {
      const up = 'deltaY' in e ? e.deltaY < 0 : true;
      if (up && el.scrollHeight - el.clientHeight > 1 && el.scrollTop > 0) stick.current = false;
    };
    const observer = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
      sync();
    });
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    el.addEventListener('wheel', onIntent, { passive: true });
    el.addEventListener('touchmove', onIntent, { passive: true });
    el.addEventListener('scroll', sync, { passive: true });
    el.scrollTop = el.scrollHeight;
    sync();
    return () => {
      observer.disconnect();
      el.removeEventListener('wheel', onIntent);
      el.removeEventListener('touchmove', onIntent);
      el.removeEventListener('scroll', sync);
    };
  }, [ref]);
  const jumpToLatest = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    stick.current = true;
    setShowJump(false);
    el.scrollTop = el.scrollHeight;
  }, [ref]);
  return { showJump, jumpToLatest };
}

interface Chip {
  id: AssistantAction;
  label: string;
}

/** Quick-action chips relevant to what the user is looking at right now. */
function contextChips(view: string, reading: boolean, composerOpen: boolean): Chip[] {
  if (composerOpen)
    return [
      { id: 'rewrite-composer', label: 'Rewrite draft' },
      { id: 'translate-composer', label: 'Translate draft' },
    ];
  if (reading)
    return [
      { id: 'summarize-thread', label: 'Summarize thread' },
      { id: 'reply-thread', label: 'Draft a reply' },
      { id: 'translate-thread', label: 'Translate' },
    ];
  if (view === 'home')
    return [
      { id: 'summarize-emails', label: 'Summarize emails' },
      { id: 'summarize-tasks', label: 'Summarize tasks' },
    ];
  return [{ id: 'summarize-emails', label: 'Summarize emails' }];
}

export function AssistantModal() {
  const reduced = usePrefersReducedMotion();
  const open = useAssistant((s) => s.open);
  const configured = useAssistant((s) => s.configured);
  const messages = useAssistant((s) => s.messages);
  const streamingId = useAssistant((s) => s.streamingId);
  const setOpen = useAssistant((s) => s.setOpen);
  const send = useAssistant((s) => s.send);
  const stop = useAssistant((s) => s.stop);
  const reset = useAssistant((s) => s.reset);

  const view = useUi((s) => s.view);
  const selectedThreadId = useUi((s) => s.selectedThreadId);
  const composerOpen = useUi((s) => !!s.composer);
  const reading = view !== 'home' && !!selectedThreadId && !selectedThreadId.startsWith('bundle:');

  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { edges, onScroll } = useScrollFade(scrollRef);
  const { showJump, jumpToLatest } = useStickToBottom(scrollRef);

  useEscapeClose(open, () => setOpen(false));

  useLayoutEffect(() => {
    if (streamingId && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streamingId]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const autosize = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  };

  const submit = () => {
    const text = input.trim();
    if (!text || streamingId) return;
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    send(text);
  };

  const chips = contextChips(view, reading, composerOpen);

  return (
    <div
      role="dialog"
      aria-label="Assistant"
      className="orb-menu-in border-hairline bg-surface absolute right-4 bottom-4 z-40 flex h-[min(560px,72vh)] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border shadow-2xl"
    >
      <header className="border-hairline flex h-11 shrink-0 items-center gap-2 border-b px-4">
        <span className="text-ink flex-1 text-[13px] font-semibold tracking-[-0.01em]">
          Assistant
        </span>
        {messages.length > 0 && (
          <button
            onClick={reset}
            aria-label="New chat"
            title="New chat"
            className="text-ink-muted hover:bg-sunken hover:text-ink flex h-7 w-7 items-center justify-center rounded-lg transition-colors"
          >
            <SquarePen size={14} />
          </button>
        )}
        <button
          onClick={() => setOpen(false)}
          aria-label="Close assistant"
          className="text-ink-muted hover:bg-sunken hover:text-ink -mr-1 flex h-7 w-7 items-center justify-center rounded-lg transition-colors"
        >
          <X size={15} />
        </button>
      </header>

      {!configured ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-ink-muted text-[12.5px] leading-relaxed">
            Add your Claude API key to turn on the assistant.
          </p>
          <button
            onClick={() => {
              setOpen(false);
              useUi.getState().setSettingsOpen(true);
            }}
            className="bg-accent flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12.5px] font-semibold text-white transition-transform active:scale-[0.97]"
          >
            <Settings2 size={14} /> Open Settings
          </button>
        </div>
      ) : (
        <>
          <div className="relative flex min-h-0 flex-1 flex-col">
            <div
              ref={scrollRef}
              onScroll={onScroll}
              className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain [overflow-anchor:none]"
            >
              <div className="mt-auto flex flex-col gap-4 px-4 py-4">
                {messages.length === 0 && (
                  <p className="text-ink-faint pt-4 text-center text-[12.5px]">
                    Ask anything, or pick a quick action below.
                  </p>
                )}
                {messages.map((m) => {
                  if (m.role === 'user')
                    return (
                      <div key={m.id} className="flex">
                        <div className="bg-sunken text-ink ml-6 max-w-[85%] rounded-2xl px-3.5 py-2 text-[12.5px] leading-6">
                          {m.content}
                        </div>
                      </div>
                    );
                  const live = m.id === streamingId;
                  return (
                    <p
                      key={m.id}
                      className={cn(
                        'max-w-prose text-[12.5px] leading-relaxed whitespace-pre-wrap',
                        m.error ? 'text-danger' : 'text-ink',
                      )}
                    >
                      {live ? (
                        m.content ? (
                          <StreamingMessage text={m.content} streaming reduced={reduced} />
                        ) : (
                          <span className="text-ink-faint">…</span>
                        )
                      ) : (
                        m.content
                      )}
                    </p>
                  );
                })}
              </div>
            </div>

            <div
              aria-hidden
              className={cn(
                'from-surface pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b to-transparent transition-opacity duration-200',
                edges.start ? 'opacity-100' : 'opacity-0',
              )}
            />
            <div
              aria-hidden
              className={cn(
                'from-surface pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t to-transparent transition-opacity duration-200',
                edges.end ? 'opacity-100' : 'opacity-0',
              )}
            />

            {showJump && (
              <button
                onClick={jumpToLatest}
                className="assistant-fade-in border-hairline bg-surface text-ink-muted hover:text-ink absolute bottom-2 left-1/2 inline-flex h-7 -translate-x-1/2 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] font-medium shadow-lg transition-colors"
              >
                <ArrowDown size={13} /> Jump to latest
              </button>
            )}
          </div>

          <div className="border-hairline flex flex-wrap gap-1.5 border-t px-3 pt-2">
            {chips.map((c) => (
              <button
                key={c.id}
                onClick={() => void runAssistantAction(c.id)}
                disabled={!!streamingId}
                className="border-hairline text-ink-muted hover:bg-accent-soft/40 hover:text-ink rounded-full border px-2.5 py-1 text-[11.5px] transition-colors disabled:opacity-50"
              >
                {c.label}
              </button>
            ))}
          </div>

          <div className="px-3 pt-2 pb-3">
            <div className="border-hairline focus-within:border-ink-faint flex items-end gap-2 rounded-2xl border px-2.5 py-1.5 transition-colors">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  autosize();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                rows={1}
                placeholder="Ask anything…"
                className="text-ink placeholder:text-ink-faint max-h-32 min-h-[28px] flex-1 resize-none bg-transparent py-1 text-[12.5px] leading-6 outline-none"
              />
              {streamingId ? (
                <button
                  onClick={stop}
                  aria-label="Stop generating"
                  className="bg-accent flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white transition-transform active:scale-95"
                >
                  <Square size={13} />
                </button>
              ) : (
                <button
                  onClick={submit}
                  disabled={!input.trim()}
                  aria-label="Send"
                  className="bg-accent flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white transition-transform active:scale-95 disabled:opacity-40"
                >
                  <ArrowUp size={16} />
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
