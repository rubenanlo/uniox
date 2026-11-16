import type { QuickReplyItem } from '@app/shared';
import { Bell, CalendarClock } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { clampIndex, shortAgo } from '../../lib/quickReply';
import { cn, hueOf, initials } from '../../lib/utils';
import { Keycaps } from '../ui/Keycap';

type Filter = 'all' | 'mail' | 'calendar';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'mail', label: 'Mail' },
  { id: 'calendar', label: 'Calendar' },
];

function chip(item: QuickReplyItem): { label: string; tone: string } | null {
  if (item.category === 'event') return { label: 'Meeting', tone: 'text-violet border-violet/40' };
  if (item.priority) return { label: 'Important', tone: 'text-priority border-priority/40' };
  if (item.reason === 'reminder') return { label: 'Reminder', tone: 'text-ink-muted border-hairline' };
  if (item.reason === 'snoozed') return { label: 'Snoozed', tone: 'text-ink-muted border-hairline' };
  return null;
}

/**
 * ⌥⌘N: every Uniox notification from the last day, newest first. ↑/↓ move,
 * ↩ opens the email in the reply widget (or joins a meeting), U marks it
 * unread, E marks it done, ⌫ drops it from the list, Tab switches the filter.
 */
export function NotificationList({
  items,
  startId,
  onOpen,
  onClose,
}: {
  items: QuickReplyItem[];
  startId: string | null;
  onOpen: (item: QuickReplyItem) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const shown = useMemo(
    () =>
      items.filter((i) =>
        filter === 'all' ? true : filter === 'calendar' ? i.category === 'event' : i.category !== 'event',
      ),
    [items, filter],
  );
  const [cursor, setCursor] = useState(() => Math.max(0, shown.findIndex((i) => i.id === startId)));
  const [unread, setUnread] = useState<Set<string>>(() => new Set());
  const active = shown[clampIndex(cursor, shown.length)];
  const listRef = useRef<HTMLDivElement>(null);
  const [now] = useState(Date.now);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cursor, filter]);

  const markUnread = (item: QuickReplyItem) => {
    if (!item.accountId || !item.messageId) return;
    const on = !unread.has(item.id);
    void api.command('task:enqueue', {
      type: 'set-seen',
      accountId: item.accountId,
      messageIds: [item.messageId],
      seen: !on,
    });
    setUnread((s) => {
      const n = new Set(s);
      if (on) n.add(item.id);
      else n.delete(item.id);
      return n;
    });
  };

  const done = (item: QuickReplyItem) => {
    if (item.accountId && item.threadId && item.category !== 'event') {
      void api.command('task:enqueue', {
        type: 'move-thread',
        accountId: item.accountId,
        threadId: item.threadId,
        toRole: 'archive',
      });
      toast('Marked as done');
    }
    void api.command('quick-reply:dismiss', { id: item.id });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => clampIndex(clampIndex(c, shown.length) + (k === 'ArrowDown' ? 1 : -1), shown.length));
      } else if (k === 'Enter' && active) {
        e.preventDefault();
        onOpen(active);
      } else if (k === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (k === 'Tab') {
        e.preventDefault();
        const at = FILTERS.findIndex((f) => f.id === filter);
        setFilter(FILTERS[(at + (e.shiftKey ? FILTERS.length - 1 : 1)) % FILTERS.length]!.id);
        setCursor(0);
      } else if ((k === 'u' || k === 'U') && active) {
        markUnread(active);
      } else if ((k === 'e' || k === 'E') && active) {
        done(active);
      } else if ((k === 'Backspace' || k === 'Delete') && active) {
        void api.command('quick-reply:dismiss', { id: active.id });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div
      role="dialog"
      aria-label="Notifications"
      className="qr-glass qr-enter absolute left-1/2 top-[14vh] w-[640px] max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-[26px] p-2.5"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="qr-tint" />
      <div className="relative">
        <div className="flex items-center gap-2.5 px-3 pb-3 pt-2.5">
          <Bell size={17} className="text-accent" />
          <span className="text-[15px] font-semibold">Notifications</span>
          <span className="text-ink-muted text-[12.5px]">
            {items.length ? `${items.length} in the last day` : 'Nothing new'}
          </span>
          <div className="ml-auto flex items-center gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => {
                  setFilter(f.id);
                  setCursor(0);
                }}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[11.5px]',
                  filter === f.id ? 'qr-field text-ink font-medium' : 'text-ink-faint hover:text-ink-muted',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div ref={listRef} className="max-h-[56vh] overflow-y-auto">
          {shown.length === 0 && (
            <p className="text-ink-muted px-4 py-10 text-center text-[13px]">
              New emails and meeting alerts show up here for a day.
            </p>
          )}
          {shown.map((item, i) => {
            const on = item === active;
            const c = chip(item);
            const who = item.title || item.fromEmail || 'Unknown';
            return (
              <button
                key={item.id}
                data-active={on}
                onMouseMove={() => setCursor(i)}
                onClick={() => onOpen(item)}
                className={cn(
                  'mb-0.5 flex w-full items-center gap-3 rounded-2xl p-3 text-left',
                  on && 'bg-accent/12 ring-accent/45 ring-[1.5px]',
                )}
              >
                <span
                  className={cn(
                    '-mr-1 h-1.5 w-1.5 shrink-0 rounded-full',
                    unread.has(item.id) && 'bg-accent',
                  )}
                />
                {item.category === 'event' ? (
                  <span className="bg-violet/15 text-violet flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px]">
                    <CalendarClock size={17} />
                  </span>
                ) : (
                  <span
                    className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-white"
                    style={{ background: `linear-gradient(135deg, hsl(${hueOf(who)} 62% 58%), hsl(${(hueOf(who) + 40) % 360} 62% 48%))` }}
                  >
                    {initials(who)}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[13.5px] font-semibold">{who}</span>
                    {c && (
                      <span className={cn('rounded-full border px-1.5 text-[10.5px] leading-[18px]', c.tone)}>
                        {c.label}
                      </span>
                    )}
                    <span className="text-ink-faint ml-auto shrink-0 text-[11.5px]">{shortAgo(item.at, now)}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-[13px]">
                    <span className="font-medium">
                      {item.category === 'event'
                        ? item.startMs
                          ? `Starts ${new Date(item.startMs).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
                          : 'Meeting'
                        : item.body || '(no subject)'}
                    </span>
                    {(item.snippet || item.location) && (
                      <span className="text-ink-muted"> — {item.snippet || item.location}</span>
                    )}
                  </span>
                </span>
                {on && <Keycaps keys={['↩']} />}
              </button>
            );
          })}
        </div>

        <div className="border-ink/8 text-ink-muted mt-1.5 flex items-center gap-4 border-t px-3.5 pb-1.5 pt-3 text-[11.5px]">
          <span className="flex items-center gap-1.5">
            <Keycaps keys={['↑', '↓']} /> move
          </span>
          <span className="flex items-center gap-1.5">
            <Keycaps keys={['↩']} /> {active?.category === 'event' ? 'open' : 'reply'}
          </span>
          <span className="flex items-center gap-1.5">
            <Keycaps keys={['U']} /> unread
          </span>
          <span className="flex items-center gap-1.5">
            <Keycaps keys={['E']} /> done
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            <Keycaps keys={['esc']} /> close
          </span>
        </div>
      </div>
    </div>
  );
}
