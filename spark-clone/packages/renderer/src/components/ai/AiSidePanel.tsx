import {
  ArrowUpRight,
  CircleCheck,
  FileSpreadsheet,
  FileText,
  HardDrive,
  KanbanSquare,
  Link2,
  Mail,
  Presentation,
  RotateCw,
  Video,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';
import { useNow } from '../../lib/workday';
import { useUi } from '../../state/store';
import { useAiCards, useTodayCards } from '../../state/aiCards';
import type { MeetingPrep, NewsCard, ResourceKind } from '../../lib/aiCards/types';
import { ago, clock } from '../../lib/aiCards/util';
import { AiBadge } from './AiCards';

function openExternal(url: string) {
  window.open(url, '_blank', 'noopener');
}

function openThread(threadId: string) {
  const ui = useUi.getState();
  useAiCards.getState().setPanel(null);
  ui.setAccountFilter(undefined);
  ui.setView('inbox');
  ui.selectThread(threadId);
}

function Panel({
  kicker,
  title,
  sub,
  footer,
  children,
}: {
  kicker: string;
  title: string;
  sub?: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  const setPanel = useAiCards((s) => s.setPanel);
  // Esc closes the panel before anything else sees it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setPanel(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [setPanel]);

  return (
    <aside
      aria-label={title}
      className="ai-glass qr-enter absolute top-4 right-4 bottom-4 z-20 flex w-[440px] max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-[26px]"
    >
      <div className="ai-rule flex items-start gap-3 border-b px-6 pt-5 pb-4">
        <div className="min-w-0 flex-1">
          <p className="text-ink-faint font-mono text-[10.5px] font-semibold tracking-[0.14em] uppercase">
            {kicker}
          </p>
          <h2 className="text-ink mt-1 text-[19px] leading-tight font-semibold tracking-[-0.01em]">
            {title}
          </h2>
          {sub}
        </div>
        <button
          onClick={() => setPanel(null)}
          className="ai-key text-ink-muted rounded-md px-1.5 py-0.5 font-mono text-[10.5px]"
          aria-label="Close"
        >
          esc
        </button>
      </div>
      <div className="no-scrollbar flex-1 overflow-y-auto px-6 py-5">{children}</div>
      <div className="ai-rule text-ink-faint flex items-center gap-1.5 border-t px-6 py-3 text-[11px]">
        {footer}
      </div>
    </aside>
  );
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="mb-6">
    <h3 className="text-ink-faint mb-2.5 font-mono text-[10.5px] font-semibold tracking-[0.14em] uppercase">
      {title}
    </h3>
    {children}
  </section>
);

const RESOURCE_ICON: Record<ResourceKind, { icon: LucideIcon; tint: string }> = {
  doc: { icon: FileText, tint: 'bg-[#e8f0fe] text-[#1a73e8]' },
  sheet: { icon: FileSpreadsheet, tint: 'bg-[#e6f4ea] text-[#1e8e3e]' },
  slides: { icon: Presentation, tint: 'bg-[#fef7e0] text-[#e37400]' },
  drive: { icon: HardDrive, tint: 'bg-[#e8f0fe] text-[#1a73e8]' },
  notion: { icon: FileText, tint: 'bg-white/70 text-ink' },
  link: { icon: Link2, tint: 'bg-white/70 text-ink-muted' },
  task: { icon: KanbanSquare, tint: 'bg-white/70 text-ink' },
};

const AVATAR_TINTS = ['#7c5cf0', '#e8834a', '#4fae6d', '#2f63e7', '#c0369b', '#0f9d9a'];

function initials(name: string): string {
  const parts = name
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

function shortWhen(at: number): string {
  const d = new Date(at);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return clock(at);
  if (Date.now() - at < 6 * 86_400_000)
    return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function PrepPanel({ prep, madeAt }: { prep: MeetingPrep; madeAt: number }) {
  const run = useAiCards((s) => s.run);
  const running = useAiCards((s) => !!s.running.meetings);
  const now = useNow().getTime();
  const when =
    prep.startMs > now
      ? `in ${ago(now - (prep.startMs - now), now)}`
      : prep.endMs > now
        ? 'now'
        : 'ended';
  const brief = [
    ['What it’s about', prep.about],
    ['Still open', prep.open],
    ['Bring', prep.bring],
  ].filter(([, v]) => v);
  const quiet = prep.attendeeCount - prep.people.filter((p) => p.lastSubject).length;

  return (
    <Panel
      kicker={`Prep · ${clock(prep.startMs)} – ${clock(prep.endMs)} · ${when}`}
      title={prep.title}
      sub={
        <div className="mt-3 flex items-center gap-2">
          {prep.meetingUrl && (
            <button
              onClick={() => openExternal(prep.meetingUrl!)}
              className="qr-ai flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold"
            >
              <Video size={13} /> Join
            </button>
          )}
          <span className="text-ink-faint ml-auto text-[11px]">
            {prep.attendeeCount} {prep.attendeeCount === 1 ? 'attendee' : 'attendees'}
          </span>
        </div>
      }
      footer={
        <>
          <AiBadge size={16} />
          From your mail, calendar and Notion · made {clock(madeAt)}
          <button
            onClick={() => void run('meetings')}
            disabled={running}
            className="hover:text-ink ml-auto flex items-center gap-1"
          >
            <RotateCw
              size={11}
              className={cn(running && 'animate-spin motion-reduce:animate-none')}
            />{' '}
            Refresh
          </button>
        </>
      }
    >
      {brief.length > 0 && (
        <Section title="Brief">
          <div className="ai-tile rounded-2xl px-4 py-3">
            <ul className="text-ink space-y-2 text-[13px] leading-relaxed">
              {brief.map(([k, v]) => (
                <li key={k}>
                  <span className="font-semibold">{k}:</span> {v}
                </li>
              ))}
            </ul>
          </div>
        </Section>
      )}
      {prep.people.length > 0 && (
        <Section title="Who you’ll see">
          {prep.people
            .filter((p) => p.lastSubject)
            .map((p, i) => (
              <button
                key={p.email}
                onClick={() => p.threadId && openThread(p.threadId)}
                className="flex w-full items-center gap-3 py-1.5 text-left"
              >
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                  style={{ background: AVATAR_TINTS[i % AVATAR_TINTS.length] }}
                >
                  {initials(p.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-ink block text-[13px] font-medium">{p.name}</span>
                  <span className="text-ink-faint block truncate text-[11.5px]">
                    <Mail size={10} className="mr-1 inline" />
                    {p.lastSubject}
                  </span>
                </span>
                {p.lastAt && (
                  <span className="text-ink-faint shrink-0 text-[11px]">{shortWhen(p.lastAt)}</span>
                )}
              </button>
            ))}
          {quiet > 0 && (
            <p className="text-ink-faint mt-1 pl-10 text-[11.5px]">
              {prep.people.filter((p) => p.lastSubject).length ? '+ ' : ''}
              {quiet} {quiet === 1 ? 'person' : 'people'} with no recent mail
            </p>
          )}
        </Section>
      )}
      {prep.resources.length > 0 && (
        <Section title="Resources">
          {prep.resources.map((r) => {
            const { icon: Icon, tint } = RESOURCE_ICON[r.kind];
            return (
              <button
                key={r.url + r.title}
                onClick={() => r.url && openExternal(r.url)}
                className="ai-tile mb-1.5 flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left"
              >
                <span
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                    tint,
                  )}
                >
                  <Icon size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-ink block truncate text-[13px] font-medium">{r.title}</span>
                  <span className="text-ink-faint block truncate text-[11px]">{r.from}</span>
                </span>
                <ArrowUpRight size={13} className="text-ink-faint shrink-0" />
              </button>
            );
          })}
        </Section>
      )}
      {prep.threads.length > 0 && (
        <Section title="Related threads">
          {prep.threads.map((t) => (
            <button
              key={t.id}
              onClick={() => openThread(t.id)}
              className="ai-rule flex w-full items-center justify-between gap-3 border-b py-2 text-left last:border-0"
            >
              <span className="text-ink truncate text-[13px]">{t.subject}</span>
              <span className="text-ink-faint shrink-0 text-[11px]">
                {t.who.split(/\s+/)[0]} · {t.count} {t.count === 1 ? 'message' : 'messages'} ·{' '}
                {shortWhen(t.at)}
              </span>
            </button>
          ))}
        </Section>
      )}
      {!brief.length && !prep.resources.length && !prep.threads.length && (
        <p className="text-ink-muted text-[13px]">
          No related email or documents found for this meeting.
        </p>
      )}
    </Panel>
  );
}

function NewsPanel({ news, madeAt }: { news: NewsCard; madeAt: number }) {
  const dismiss = useAiCards((s) => s.dismiss);
  const themes: string[] = [];
  for (const s of news.stories) if (!themes.includes(s.theme)) themes.push(s.theme);

  const archiveAll = () => {
    for (const t of news.threads) {
      void api.command('task:enqueue', {
        type: 'move-thread',
        accountId: t.accountId,
        threadId: t.id,
        toRole: 'archive',
      });
    }
    toast(`Archived ${news.threads.length} ${news.threads.length === 1 ? 'email' : 'emails'}`);
  };

  return (
    <Panel
      kicker={`Today’s news · ${new Date(madeAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}`}
      title={`${news.stories.length} stories from ${news.editions.length} ${news.editions.length === 1 ? 'edition' : 'editions'}`}
      sub={
        <p className="text-ink-muted mt-1.5 text-[12.5px]">
          {news.editions.join(', ')}.{news.merged > 0 && ` ${news.merged} duplicates merged.`}
        </p>
      }
      footer={
        <>
          <AiBadge size={16} />
          Made {clock(madeAt)}
          <button
            onClick={archiveAll}
            className="text-accent ml-auto flex items-center gap-1 font-medium"
          >
            <CircleCheck size={12} /> Archive the {news.threads.length}{' '}
            {news.threads.length === 1 ? 'email' : 'emails'}
          </button>
        </>
      }
    >
      {themes.map((theme) => (
        <Section key={theme} title={theme}>
          {news.stories
            .filter((s) => s.theme === theme)
            .map((s) => (
              <button
                key={s.title}
                onClick={() => s.url && openExternal(s.url)}
                disabled={!s.url}
                className="block w-full py-2 text-left disabled:cursor-default"
              >
                <span className="flex items-start gap-2">
                  <span className="text-ink flex-1 text-[13.5px] leading-snug font-medium">
                    {s.title}
                  </span>
                  {s.url && <ArrowUpRight size={13} className="text-ink-faint mt-0.5 shrink-0" />}
                </span>
                <span className="text-ink-muted mt-0.5 block text-[12.5px] leading-relaxed">
                  {s.blurb}
                </span>
                <span className="text-ink-faint mt-1 block font-mono text-[10px] tracking-[0.08em] uppercase">
                  {s.sources.join(' · ')}
                </span>
              </button>
            ))}
        </Section>
      ))}
      {!news.stories.length && (
        <p className="text-ink-muted text-[13px]">
          No stories found.{' '}
          <button className="text-accent" onClick={() => dismiss('news')}>
            Dismiss
          </button>
        </p>
      )}
    </Panel>
  );
}

/** The floating frosted panel on the right of Home: a meeting's prep, or the news. */
export function AiSidePanel() {
  const panel = useAiCards((s) => s.panel);
  const cards = useTodayCards();
  if (!panel) return null;
  if (panel.kind === 'news' && cards.news) {
    return <NewsPanel news={cards.news.data} madeAt={cards.news.madeAt} />;
  }
  if (panel.kind === 'meetings' && cards.meetings) {
    const prep = cards.meetings.data.meetings.find((m) => m.eventId === panel.eventId);
    if (prep) return <PrepPanel prep={prep} madeAt={cards.meetings.madeAt} />;
  }
  return null;
}
