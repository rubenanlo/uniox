import { CalendarDays, KanbanSquare, Newspaper, Reply, RotateCw, Sparkles, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { useNow } from '../../lib/workday';
import { openSprintBoard } from '../../state/kanban';
import { useUi } from '../../state/store';
import { useAiCards, useTodayCards } from '../../state/aiCards';
import { AI_CARD_ORDER, type AiCardKind, type TaskBucket } from '../../lib/aiCards/types';
import { ago, clock, firstName } from '../../lib/aiCards/util';

/** The gradient sparkle badge every AI surface carries. */
export function AiBadge({ size = 16 }: { size?: number }) {
  return (
    <span
      className="qr-ai flex shrink-0 items-center justify-center rounded-[6px]"
      style={{ width: size, height: size }}
    >
      <Sparkles size={Math.round(size * 0.6)} />
    </span>
  );
}

function Card({
  kind,
  icon: Icon,
  label,
  headline,
  madeAt,
  active,
  onOpen,
  children,
}: {
  kind: AiCardKind;
  icon: LucideIcon;
  label: string;
  headline: string;
  madeAt: number;
  active?: boolean;
  onOpen?: () => void;
  children: ReactNode;
}) {
  const run = useAiCards((s) => s.run);
  const dismiss = useAiCards((s) => s.dismiss);
  const running = useAiCards((s) => !!s.running[kind]);
  return (
    <div
      className={cn(
        'ai-glass group relative flex min-w-0 flex-col rounded-[18px] p-4',
        active && 'ring-accent/40 ring-2',
      )}
    >
      <div className="text-ink-faint flex items-center gap-1.5 font-mono text-[10px] font-semibold tracking-[0.14em] uppercase">
        <Icon size={12} />
        <span className="flex-1 truncate">{label}</span>
        <button
          onClick={() => dismiss(kind)}
          title="Dismiss"
          aria-label={`Dismiss ${label}`}
          className="hover:text-ink -m-1 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        >
          <X size={12} />
        </button>
      </div>
      <button
        onClick={onOpen}
        disabled={!onOpen}
        className="text-ink mt-2 text-left text-[14px] leading-snug font-semibold disabled:cursor-default"
      >
        {headline}
      </button>
      <div className="mt-2 flex flex-1 flex-col gap-1">{children}</div>
      <div className="text-ink-faint mt-3 flex items-center gap-1.5 text-[10.5px]">
        <AiBadge size={14} />
        <span>Made {clock(madeAt)}</span>
        <button
          onClick={() => void run(kind)}
          disabled={running}
          title="Refresh"
          aria-label={`Refresh ${label}`}
          className="hover:text-ink -m-1 ml-auto rounded p-1"
        >
          <RotateCw
            size={11}
            className={cn(running && 'animate-spin motion-reduce:animate-none')}
          />
        </button>
      </div>
    </div>
  );
}

function Line({
  lead,
  tone,
  trail,
  onClick,
  children,
}: {
  lead?: string;
  tone?: 'danger' | 'accent';
  /** Stays visible when the text is cut short. */
  trail?: ReactNode;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className="hover:text-ink flex min-w-0 items-baseline gap-2 text-left text-[12px] disabled:cursor-default"
    >
      {lead && (
        <span
          className={cn(
            'shrink-0 font-mono text-[10.5px] tabular-nums',
            tone === 'danger'
              ? 'text-danger'
              : tone === 'accent'
                ? 'text-accent'
                : 'text-ink-faint',
          )}
        >
          {lead}
        </span>
      )}
      <span className="text-ink-muted min-w-0 truncate">{children}</span>
      {trail && <span className="shrink-0">{trail}</span>}
    </button>
  );
}

const BUCKET_LEAD: Record<TaskBucket, string> = {
  overdue: 'late',
  today: 'today',
  week: 'soon',
  later: 'later',
  none: 'no date',
};

function openThread(threadId: string) {
  const ui = useUi.getState();
  ui.setAccountFilter(undefined);
  ui.setView('inbox');
  ui.selectThread(threadId);
}

/** Today's AI cards under the Home timeline: only the ones the user asked for. */
export function AiCardsRow() {
  const cards = useTodayCards();
  const panel = useAiCards((s) => s.panel);
  const setPanel = useAiCards((s) => s.setPanel);
  const nowDate = useNow();
  const kinds = AI_CARD_ORDER.filter((k) => cards[k]);
  if (!kinds.length) return null;
  const now = nowDate.getTime();

  return (
    <div
      className="home-rise col-span-2 mt-10 grid gap-3"
      style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', animationDelay: '0.15s' }}
    >
      {kinds.map((kind) => {
        if (kind === 'meetings') {
          const { madeAt, data } = cards.meetings!;
          const upcoming = data.meetings.filter((m) => m.endMs > now);
          const next = upcoming.find((m) => m.startMs > now);
          const headline = !upcoming.length
            ? 'No more meetings today'
            : `${upcoming.length} today` +
              (next ? ` · next in ${ago(now - (next.startMs - now), now)}` : ' · one now');
          return (
            <Card
              key={kind}
              kind={kind}
              icon={CalendarDays}
              label="Meetings"
              headline={headline}
              madeAt={madeAt}
              active={panel?.kind === 'meetings'}
              onOpen={
                upcoming[0]
                  ? () => setPanel({ kind: 'meetings', eventId: upcoming[0]!.eventId })
                  : undefined
              }
            >
              {upcoming.slice(0, 3).map((m, i) => (
                <Line
                  key={m.eventId}
                  lead={clock(m.startMs)}
                  tone={i === 0 ? 'accent' : undefined}
                  onClick={() => setPanel({ kind: 'meetings', eventId: m.eventId })}
                  trail={<span className="text-accent font-medium">Prep</span>}
                >
                  {m.title}
                </Line>
              ))}
            </Card>
          );
        }
        if (kind === 'tasks') {
          const { madeAt, data } = cards.tasks!;
          const headline =
            data.overdue || data.today
              ? `${data.overdue} overdue · ${data.today} due today`
              : data.total
                ? `${data.total} open tasks`
                : 'Nothing on your plate';
          return (
            <Card
              key={kind}
              kind={kind}
              icon={KanbanSquare}
              label="On your plate"
              headline={headline}
              madeAt={madeAt}
              onOpen={openSprintBoard}
            >
              {data.top.map((t) => (
                <Line
                  key={t.id}
                  lead={BUCKET_LEAD[t.bucket]}
                  tone={t.bucket === 'overdue' ? 'danger' : undefined}
                  onClick={openSprintBoard}
                >
                  {t.title}
                </Line>
              ))}
            </Card>
          );
        }
        if (kind === 'reply') {
          const { madeAt, data } = cards.reply!;
          return (
            <Card
              key={kind}
              kind={kind}
              icon={Reply}
              label="Needs reply"
              headline={
                data.items.length ? `${data.items.length} waiting on you` : 'You’re all caught up'
              }
              madeAt={madeAt}
            >
              {data.items.slice(0, 3).map((r) => (
                <Line key={r.threadId} lead={ago(r.at, now)} onClick={() => openThread(r.threadId)}>
                  {firstName(r.who)} · {r.ask}
                </Line>
              ))}
            </Card>
          );
        }
        const { madeAt, data } = cards.news!;
        return (
          <Card
            key={kind}
            kind={kind}
            icon={Newspaper}
            label="Today’s news"
            headline={`${data.stories.length} stories · ${data.editions.length} ${data.editions.length === 1 ? 'edition' : 'editions'}`}
            madeAt={madeAt}
            active={panel?.kind === 'news'}
            onOpen={() => setPanel({ kind: 'news' })}
          >
            {data.stories.slice(0, 3).map((s) => (
              <Line
                key={s.title}
                lead={s.theme.split(/[\s&]+/)[0]!.slice(0, 4)}
                onClick={() => setPanel({ kind: 'news' })}
              >
                {s.title}
              </Line>
            ))}
          </Card>
        );
      })}
    </div>
  );
}
