import {
  Briefcase,
  Coffee,
  Fingerprint,
  Languages,
  Reply,
  ScrollText,
  Sparkles,
  Wand2,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { DraftRewrite } from '../../lib/quickReplyAi';
import { cn } from '../../lib/utils';
import { LanguagePicker } from '../orb/LanguagePicker';
import { Keycaps } from '../ui/Keycap';

export type AiMenuPick =
  | { kind: 'rewrite'; action: DraftRewrite; language?: string }
  | { kind: 'summarize' }
  | { kind: 'write' }
  | { kind: 'translate-thread' }
  | { kind: 'ask'; question: string };

interface Row {
  label: string;
  icon: LucideIcon;
  pick: AiMenuPick;
  /** Needs something typed in the reply first. */
  needsDraft?: boolean;
  language?: boolean;
}

/** The composer's AI options, then what the assistant can do with the email itself. */
const DRAFT_ROWS: Row[] = [
  { label: 'Rewrite to make it flow', icon: Wand2, pick: { kind: 'rewrite', action: 'rewrite-composer' }, needsDraft: true },
  { label: 'Rewrite in my style', icon: Fingerprint, pick: { kind: 'rewrite', action: 'style-composer' }, needsDraft: true },
  { label: 'Turn it formal', icon: Briefcase, pick: { kind: 'rewrite', action: 'formal-composer' }, needsDraft: true },
  { label: 'Turn it informal', icon: Coffee, pick: { kind: 'rewrite', action: 'informal-composer' }, needsDraft: true },
  {
    label: 'Translate into…',
    icon: Languages,
    pick: { kind: 'rewrite', action: 'translate-composer' },
    needsDraft: true,
    language: true,
  },
];
const EMAIL_ROWS: Row[] = [
  { label: 'Summarize the thread', icon: ScrollText, pick: { kind: 'summarize' } },
  { label: 'Write the reply for me', icon: Reply, pick: { kind: 'write' } },
];
/** Extra row for the reading pane's chat, where this menu also stands in for ⌘.'s email actions. */
const TRANSLATE_ROW: Row = { label: 'Translate into English', icon: Languages, pick: { kind: 'translate-thread' } };

/**
 * The rail's AI menu (⌘J on the island, ⌘. in the reading pane's chat): pick
 * with ↑/↓ ↩ or the number keys, or ask anything about the
 * email in the field at the bottom. Draft rewrites grey out until there is a
 * draft to rewrite.
 */
export function AiMenu({
  hasDraft,
  onPick,
  onClose,
  className = 'qr-glass left-[calc(100%+14px)] top-0',
  translate = false,
}: {
  hasDraft: boolean;
  onPick: (pick: AiMenuPick) => void;
  onClose: () => void;
  /** Surface and position (default: glass, beside the island's rail). */
  className?: string;
  /** Also offer "Translate into English" for the email. */
  translate?: boolean;
}) {
  const emailRows = translate ? [...EMAIL_ROWS, TRANSLATE_ROW] : EMAIL_ROWS;
  const rows = [...DRAFT_ROWS, ...emailRows];
  const usable = (r: Row) => !r.needsDraft || hasDraft;
  const [active, setActive] = useState(() => rows.findIndex(usable));
  const [question, setQuestion] = useState('');
  const [picking, setPicking] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const choose = (r: Row | undefined) => {
    if (!r || !usable(r)) return;
    if (r.language) return setPicking(true);
    onPick(r.pick);
  };

  useEffect(() => {
    if (picking) return;
    const onKey = (e: KeyboardEvent) => {
      const inField = (e.target as HTMLElement).tagName === 'INPUT';
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (inField) {
        return;
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        setActive((a) => {
          for (let i = 1; i <= rows.length; i++) {
            const n = (a + dir * i + rows.length) % rows.length;
            if (usable(rows[n]!)) return n;
          }
          return a;
        });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        choose(rows[active]);
      } else if (/^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        choose(rows[Number(e.key) - 1]);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest('[data-ai-toggle]')) onClose();
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const item = (r: Row, i: number) => (
    <button
      key={r.label}
      disabled={!usable(r)}
      onMouseMove={() => usable(r) && setActive(i)}
      onClick={() => choose(r)}
      className={cn(
        'flex h-[34px] w-full items-center gap-2.5 rounded-[9px] px-2.5 text-left text-[13px] disabled:opacity-40',
        i === active && 'bg-accent/13',
      )}
    >
      <r.icon size={15} className="text-ink-muted" />
      {r.label}
      <span className="ml-auto">
        <Keycaps keys={[String(i + 1)]} />
      </span>
    </button>
  );

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Assistant"
      className={cn('qr-enter absolute z-20 w-[300px] rounded-2xl p-2', className)}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {picking ? (
        <LanguagePicker
          onPick={(language) => onPick({ kind: 'rewrite', action: 'translate-composer', language })}
          onBack={() => setPicking(false)}
        />
      ) : (
        <>
          <p className="text-ink-faint px-2.5 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em]">
            Your reply
          </p>
          {DRAFT_ROWS.map((r, i) => item(r, i))}
          <div className="bg-ink/8 mx-2 my-1.5 h-px" />
          <p className="text-ink-faint px-2.5 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.06em]">
            This email
          </p>
          {emailRows.map((r, i) => item(r, i + DRAFT_ROWS.length))}
          <form
            className="qr-field mx-1 mb-0.5 mt-1.5 flex h-[34px] items-center gap-2 rounded-[10px] px-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (question.trim()) onPick({ kind: 'ask', question: question.trim() });
            }}
          >
            <Sparkles size={14} className="text-ink-faint" />
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask anything about this email…"
              className="placeholder:text-ink-faint min-w-0 flex-1 bg-transparent text-[12.5px] outline-none"
            />
          </form>
        </>
      )}
    </div>
  );
}
