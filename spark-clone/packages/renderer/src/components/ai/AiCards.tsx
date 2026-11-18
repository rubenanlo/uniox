import { CalendarDays, KanbanSquare, Newspaper, Reply, RotateCw, Sparkles, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { useNow } from '../../lib/workday';
import { openSprintBoard } from '../../state/kanban';
import { useUi } from '../../state/store';
import { useAiCards, useTodayCards } from '../../state/aiCards';
import { AI_CARD_ORDER, type AiCardKind, type TaskBucket } from '../../lib/aiCards/types';
import type { SavedCards } from '../../lib/aiCards/types';
import {
  boxOf,
  CARD_LAYOUT_MS,
  CARD_SPRING,
  enterCard,
  exitCard,
  glideCard,
  type CardBox,
} from './cardMotion';
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
        'ai-glass group relative flex min-w-0 flex-1 flex-col rounded-[18px] p-4',
        active && 'ring-accent/40 ring-2',
      )}
    >
      <div
        data-ai-part
        className="text-ink-faint flex items-center gap-1.5 font-mono text-[10px] font-semibold tracking-[0.14em] uppercase"
      >
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
        data-ai-part
        onClick={onOpen}
        disabled={!onOpen}
        className="text-ink mt-2 text-left text-[14px] leading-snug font-semibold disabled:cursor-default"
      >
        {headline}
      </button>
      <div data-ai-lines className="mt-2 flex flex-1 flex-col gap-1">
        {children}
      </div>
      <div data-ai-part className="text-ink-faint mt-3 flex items-center gap-1.5 text-[10.5px]">
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

/** Today's AI cards under the Home timeline: only the ones the user asked for.
 *  Cards unfold in and fold out (cardMotion.ts); the row and the cards
 *  already on screen glide to make room. `onShownChange` tells Home when the
 *  row opens or closes (and whether to animate), so the timeline can give up
 *  or take back its height on the same spring. */
export function AiCardsRow({
  onShownChange,
}: {
  onShownChange?: (shown: boolean, animate: boolean) => void;
}) {
  const cards = useTodayCards();
  const loaded = useAiCards((s) => s.loaded);
  const panel = useAiCards((s) => s.panel);
  const setPanel = useAiCards((s) => s.setPanel);
  const nowDate = useNow();
  const now = nowDate.getTime();

  const live = AI_CARD_ORDER.filter((k) => cards[k]);
  const liveKey = live.join(',');

  const [shown, setShown] = useState<AiCardKind[]>(live);
  const [leaving, setLeaving] = useState<AiCardKind[]>([]);
  // Leaving cards keep rendering their last data while they fold away.
  const [kept, setKept] = useState<SavedCards>(cards);
  // No motion for the cards already there when Home opens or the saved cards
  // load; only for cards asked for (or dismissed) while you watch.
  const [motion, setMotion] = useState(false);
  const [prev, setPrev] = useState({ key: liveKey, loaded });
  if (prev.key !== liveKey || prev.loaded !== loaded) {
    setPrev({ key: liveKey, loaded });
    setKept({ ...kept, ...cards });
    const animate = prev.loaded;
    if (animate !== motion) setMotion(animate);
    const added = live.filter((k) => !shown.includes(k));
    const gone = shown.filter((k) => !live.includes(k));
    // A card asked for again mid-exit simply stays.
    const nextLeaving = animate ? gone : [];
    if (nextLeaving.join(',') !== leaving.join(',')) setLeaving(nextLeaving);
    const next = AI_CARD_ORDER.filter((k) => live.includes(k) || (animate && shown.includes(k)));
    if (next.join(',') !== shown.join(',') || added.length) setShown(next);
  }
  const view: SavedCards = { ...kept, ...cards };

  const els = useRef(new Map<AiCardKind, HTMLDivElement>());
  const boxes = useRef(new Map<AiCardKind, CardBox>());
  const prevShown = useRef<AiCardKind[]>(shown);
  const measure = () => new Map([...els.current].map(([k, el]) => [k, boxOf(el)]));

  // After each change to the row: new cards unfold, the others glide from
  // where they were to their new slot and height.
  const shownKey = shown.join(',');
  useLayoutEffect(() => {
    const before = prevShown.current;
    const now = measure();
    for (const [k, el] of els.current) {
      if (!before.includes(k)) {
        if (motion) enterCard(el, { first: before.length === 0 });
      } else if (motion && boxes.current.has(k)) glideCard(el, boxes.current.get(k)!);
    }
    prevShown.current = shown;
    boxes.current = now;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownKey]);

  const exiting = useRef(new Set<AiCardKind>());
  const leavingKey = leaving.join(',');
  useEffect(() => {
    for (const k of exiting.current) {
      if (leaving.includes(k)) continue;
      // Asked for again mid-exit: stop folding.
      exiting.current.delete(k);
      els.current
        .get(k)
        ?.getAnimations({ subtree: true })
        .forEach((a) => a.cancel());
    }
    for (const k of leaving) {
      if (exiting.current.has(k)) continue;
      const el = els.current.get(k);
      const done = () => {
        exiting.current.delete(k);
        setShown((s) => s.filter((x) => x !== k));
        setLeaving((l) => l.filter((x) => x !== k));
      };
      if (!el) {
        done();
        continue;
      }
      exiting.current.add(k);
      exitCard(el).then(done, () => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leavingKey]);

  // The row's height follows its cards (a row stretches to its tallest card)
  // and folds to nothing once the last card is gone.
  const innerRef = useRef<HTMLDivElement>(null);
  const [innerH, setInnerH] = useState(0);
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setInnerH(el.offsetHeight);
      boxes.current = measure();
    });
    ro.observe(el);
    setInnerH(el.offsetHeight);
    return () => ro.disconnect();
  }, []);
  const open = shown.length > 0;
  useEffect(() => onShownChange?.(open, motion), [open, motion, onShownChange]);

  const renderCard = (kind: AiCardKind) => {
    const cards = view;
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
  };

  return (
    <div
      className={cn(
        'home-rise col-span-2',
        motion && 'transition-[height,margin-top] motion-reduce:transition-none',
      )}
      style={{
        height: open ? innerH : 0,
        marginTop: open ? 40 : 0,
        transitionDuration: `${CARD_LAYOUT_MS}ms`,
        transitionTimingFunction: CARD_SPRING,
        animationDelay: '0.15s',
      }}
    >
      <div
        ref={innerRef}
        className="grid gap-3"
        style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}
      >
        {shown.map((kind) => (
          <div
            key={kind}
            ref={(el) => {
              if (el) els.current.set(kind, el);
              else els.current.delete(kind);
            }}
            className={cn('relative flex min-w-0', leaving.includes(kind) && 'pointer-events-none')}
          >
            {renderCard(kind)}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 overflow-hidden rounded-[18px]"
            >
              <span
                data-ai-sheen
                className="ai-sheen absolute -inset-y-[20%] left-0 w-[45%]"
                style={{ transform: 'translateX(-140%) skewX(-18deg)' }}
              />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
