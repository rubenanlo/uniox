import type { QuickReplyItem } from '@app/shared';
import { Menu } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { LIST_TABS, clampIndex, listTab, startTab, type ListTab } from '../../lib/quickReply';
import { cn } from '../../lib/utils';

function eventLine(item: QuickReplyItem): string {
  const when = item.startMs
    ? `Starts ${new Date(item.startMs).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
    : 'Meeting';
  return item.location ? `${when} · ${item.location}` : when;
}

/**
 * ⌥⌘N: every Uniox notification from the last day, filed under Important,
 * Calendar, Docs and Other. ←/→ (or Tab / ⇧Tab) switch tabs, ↑/↓ move, ↩
 * opens the email in the reply widget (or joins a meeting), U marks it
 * unread, E marks it done, ⌫ drops it from the list.
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
  const [tab, setTab] = useState<ListTab>(() => startTab(items, startId));
  const byTab = useMemo(() => {
    const m: Record<ListTab, QuickReplyItem[]> = { important: [], calendar: [], docs: [], other: [] };
    for (const i of items) m[listTab(i)].push(i);
    return m;
  }, [items]);
  const shown = byTab[tab];
  // One cursor per tab, so hopping across tabs and back keeps your place.
  const [cursors, setCursors] = useState<Record<ListTab, number>>(() => {
    const c = { important: 0, calendar: 0, docs: 0, other: 0 };
    const start = items.find((i) => i.id === startId);
    if (start) c[listTab(start)] = Math.max(0, byTabOf(items, listTab(start)).indexOf(start));
    return c;
  });
  const cursor = clampIndex(cursors[tab], shown.length);
  const active = shown[cursor];
  const setCursor = (n: number) => setCursors((c) => ({ ...c, [tab]: clampIndex(n, shown.length) }));
  const [unread, setUnread] = useState<Set<string>>(() => new Set());
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cursor, tab]);

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

  const stepTab = (dir: 1 | -1) => {
    const at = LIST_TABS.findIndex((t) => t.id === tab);
    setTab(LIST_TABS[(at + dir + LIST_TABS.length) % LIST_TABS.length]!.id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        e.preventDefault();
        setCursor(cursor + (k === 'ArrowDown' ? 1 : -1));
      } else if (k === 'ArrowRight' || k === 'ArrowLeft') {
        e.preventDefault();
        stepTab(k === 'ArrowRight' ? 1 : -1);
      } else if (k === 'Tab') {
        e.preventDefault();
        stepTab(e.shiftKey ? -1 : 1);
      } else if (k === 'Enter' && active) {
        e.preventDefault();
        onOpen(active);
      } else if (k === 'Escape') {
        e.preventDefault();
        onClose();
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
      className="qr-glass qr-enter absolute left-1/2 top-[14vh] w-[820px] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-hidden rounded-[22px] py-3"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="qr-tint" />
      <div className="relative">
        <div role="tablist" className="flex items-center gap-7 px-5 pb-2 pt-1.5">
          <Menu size={20} className="text-ink-muted -mr-1 shrink-0" aria-hidden />
          {LIST_TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'text-[17px] tracking-[-0.01em] transition-colors',
                tab === t.id ? 'text-ink' : 'text-ink-muted hover:text-ink',
              )}
            >
              {t.label} <span className="text-ink-faint tabular-nums">{byTab[t.id].length}</span>
            </button>
          ))}
        </div>

        <div ref={listRef} role="listbox" className="max-h-[56vh] overflow-y-auto">
          {shown.length === 0 && (
            <p className="text-ink-muted px-[64px] py-8 text-[14px]">
              {items.length
                ? 'Nothing here. ← → for the other tabs.'
                : 'New emails and meeting alerts show up here for a day.'}
            </p>
          )}
          {shown.map((item, i) => {
            const on = item === active;
            const event = item.category === 'event';
            const subject = event ? item.title : item.body || '(no subject)';
            const preview = event ? eventLine(item) : item.snippet;
            return (
              <button
                key={item.id}
                role="option"
                aria-selected={on}
                data-active={on}
                onMouseMove={() => setCursor(i)}
                onClick={() => onOpen(item)}
                className={cn(
                  'relative flex h-[44px] w-full items-center gap-0 text-left text-[15px] transition-colors',
                  on && 'bg-ink/[0.045]',
                )}
              >
                {/* The selection mark: a thin bar on the panel's edge. */}
                <span
                  className={cn(
                    'bg-ink absolute bottom-2 left-0 top-2 w-[2.5px] rounded-r-full transition-opacity',
                    on ? 'opacity-90' : 'opacity-0',
                  )}
                />
                <span className="flex w-[205px] shrink-0 items-center gap-2 pl-[64px] pr-4">
                  <span className={cn('truncate', on ? 'text-ink' : 'text-ink/85')}>
                    {event ? 'Calendar' : item.title || item.fromEmail || 'Unknown'}
                  </span>
                  {unread.has(item.id) && <span className="bg-accent h-1.5 w-1.5 shrink-0 rounded-full" />}
                </span>
                <span className="min-w-0 flex-1 truncate pr-6">
                  <span className={cn(on ? 'text-ink' : 'text-ink/90', item.priority && 'font-medium')}>{subject}</span>
                  {preview && <span className="text-ink-faint ml-3">{preview}</span>}
                </span>
              </button>
            );
          })}
        </div>
        <div className="text-ink-faint flex justify-end gap-4 px-5 pt-2.5 text-[11.5px]">
          <span>← → tabs</span>
          <span>↩ {active?.category === 'event' ? 'join' : 'reply'}</span>
          <span>U unread</span>
          <span>E done</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}

function byTabOf(items: QuickReplyItem[], tab: ListTab): QuickReplyItem[] {
  return items.filter((i) => listTab(i) === tab);
}
