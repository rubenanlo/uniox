import type { QuickReplyItem } from '@app/shared';
import { Bell, ChevronDown, Pin } from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAccountColor } from '../../lib/accountColor';
import { api } from '../../lib/api';
import {
  LIST_SECTIONS,
  LIST_TABS,
  accountForDigit,
  clampIndex,
  itemPayload,
  listRows,
  shortAgo,
  startTab,
  unreadItem,
  type ListRow,
  type ListSection,
  type ListTab,
} from '../../lib/quickReply';
import { cn } from '../../lib/utils';
import { useAccounts, useDelta } from '../../state/queries';
import { Keycaps } from '../ui/Keycap';

/** How many unread threads the list loads (all accounts; the account switch filters them). */
const UNREAD_LIMIT = 200;

function eventLine(item: QuickReplyItem): string {
  const when = item.startMs
    ? `Starts ${new Date(item.startMs).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
    : 'Meeting';
  return item.location ? `${when} · ${item.location}` : when;
}

/** Unread inbox threads, refreshed as mail changes while the list is open. */
function useUnreadItems(): QuickReplyItem[] {
  const [rows, setRows] = useState<QuickReplyItem[]>([]);
  const refresh = useCallback(() => {
    void api
      .query('threads:unread', { limit: UNREAD_LIMIT })
      .then((threads) => setRows(threads.map(unreadItem)))
      .catch(() => {});
  }, []);
  useEffect(refresh, [refresh]);
  useDelta((e) => {
    if (e.kind === 'threads-changed' || e.kind === 'accounts-changed') refresh();
  });
  return rows;
}

function SectionIcon({ section }: { section: ListSection }) {
  if (section === 'kept') return <Pin size={12} className="-rotate-45" />;
  if (section === 'new') return <Bell size={12} />;
  return <span className="bg-accent h-[7px] w-[7px] rounded-full" />;
}

/**
 * ⌥⌘N: emails you kept, the notifications from the last day, then the rest of
 * your unread mail, filed under Important, Calendar, Docs and Other. The pill
 * at the top right picks the account (⌘1 All, ⌘2… each account, as in the
 * main window). ←/→ (or Tab / ⇧Tab) switch tabs, ↑/↓ move, ↩ opens the email
 * in the reply widget (or joins a meeting), K keeps it here after it's read,
 * U toggles unread, E marks it done, ⌫ drops a notification from the list.
 *
 * Nothing here marks mail read: only opening an email (↩) does.
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
  const unreadItems = useUnreadItems();
  const { accounts } = useAccounts();
  const colorOf = useAccountColor();
  const multi = accounts.length > 1;
  const [accountId, setAccountId] = useState('');
  const [tab, setTab] = useState<ListTab>(() => startTab(items, startId));

  const rowsByTab = useMemo(() => {
    const m = {} as Record<ListTab, ListRow[]>;
    for (const t of LIST_TABS) m[t.id] = listRows(items, unreadItems, t.id, accountId || undefined);
    return m;
  }, [items, unreadItems, accountId]);
  const rows = rowsByTab[tab];

  // One cursor per tab, so hopping across tabs and back keeps your place.
  const [cursors, setCursors] = useState<Record<ListTab, number>>(() => {
    const c = { important: 0, calendar: 0, docs: 0, other: 0 };
    const start = items.find((i) => i.id === startId);
    if (start) {
      const t = startTab(items, startId);
      c[t] = Math.max(0, listRows(items, [], t).findIndex((r) => r.item.id === start.id));
    }
    return c;
  });
  const cursor = clampIndex(cursors[tab], rows.length);
  const active = rows[cursor]?.item;
  const setCursor = (n: number) => setCursors((c) => ({ ...c, [tab]: clampIndex(n, rows.length) }));
  // Notifications marked unread from here (U), shown with a dot until the list closes.
  const [markedUnread, setMarkedUnread] = useState<Set<string>>(() => new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const [now] = useState(Date.now);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cursor, tab]);

  const switchAccount = (id: string) => {
    setAccountId(id);
    setCursors({ important: 0, calendar: 0, docs: 0, other: 0 });
  };

  const markUnread = (item: QuickReplyItem) => {
    if (!item.accountId) return;
    if (item.id.startsWith('u:')) {
      // An unread thread: U marks it read (it then leaves the list unless kept).
      if (!item.threadId) return;
      void api.query('thread:messages', { threadId: item.threadId }).then((msgs) => {
        const ids = msgs.filter((m) => !m.seen && m.accountId === item.accountId).map((m) => m.id);
        if (ids.length) void api.command('task:enqueue', { type: 'set-seen', accountId: item.accountId!, messageIds: ids, seen: true });
      });
      toast('Marked as read');
      return;
    }
    if (!item.messageId) return;
    const on = !markedUnread.has(item.id);
    void api.command('task:enqueue', {
      type: 'set-seen',
      accountId: item.accountId,
      messageIds: [item.messageId],
      seen: !on,
    });
    setMarkedUnread((s) => {
      const n = new Set(s);
      if (on) n.add(item.id);
      else n.delete(item.id);
      return n;
    });
  };

  const keep = (item: QuickReplyItem) => {
    if (item.category === 'event') return;
    const on = !item.kept;
    const args = item.id.startsWith('u:') ? { item: itemPayload(item), keep: on } : { id: item.id, keep: on };
    void api.command('quick-reply:keep', args);
    toast(on ? 'Kept in the list' : 'No longer kept');
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
    if (!item.id.startsWith('u:')) void api.command('quick-reply:dismiss', { id: item.id });
  };

  const stepTab = (dir: 1 | -1) => {
    const at = LIST_TABS.findIndex((t) => t.id === tab);
    setTab(LIST_TABS[(at + dir + LIST_TABS.length) % LIST_TABS.length]!.id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      // ⌘1 All accounts, ⌘2… each account, matching the main window.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && /^Digit[1-9]$/.test(e.code)) {
        const id = accountForDigit(Number(e.code.slice(5)), accounts.map((a) => a.id));
        if (id !== null) {
          e.preventDefault();
          switchAccount(id);
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
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
      } else if ((k === 'k' || k === 'K') && active) {
        keep(active);
      } else if ((k === 'u' || k === 'U') && active) {
        markUnread(active);
      } else if ((k === 'e' || k === 'E') && active) {
        done(active);
      } else if ((k === 'Backspace' || k === 'Delete') && active && !active.id.startsWith('u:')) {
        void api.command('quick-reply:dismiss', { id: active.id });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const options = [{ id: '', label: 'All accounts', color: null as string | null }].concat(
    accounts.map((a) => ({ id: a.id, label: a.displayName || a.email, color: colorOf(a.id) })),
  );
  const current = options.find((o) => o.id === accountId) ?? options[0]!;

  return (
    <div
      role="dialog"
      aria-label="Notifications"
      className="qr-glass qr-enter absolute left-1/2 top-[14vh] w-[820px] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-hidden rounded-[20px] pb-2.5 pt-1.5"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="qr-tint" />
      <div className="relative">
        <div className="border-ink/8 flex items-end gap-[22px] border-b px-[22px] pt-2.5">
          <div role="tablist" className="flex items-end gap-[22px]">
            {LIST_TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'relative pb-2.5 text-[14.5px] transition-colors',
                  tab === t.id ? 'text-ink font-semibold' : 'text-ink-muted hover:text-ink',
                )}
              >
                {t.label}
                <span className="text-ink-faint ml-[5px] text-[12.5px] font-medium tabular-nums">
                  {rowsByTab[t.id].length}
                </span>
                {tab === t.id && <span className="qr-underline absolute inset-x-0 -bottom-px h-[2px] rounded-full" />}
              </button>
            ))}
          </div>
          {multi && (
            // Collapsed to the current account; hovering opens the others.
            <div
              role="radiogroup"
              aria-label="Account"
              className="bg-ink/[0.06] group mb-2 ml-auto flex items-center rounded-full p-[3px] text-[12.5px]"
            >
              {options.map((o, i) => {
                const on = o.id === current.id;
                return (
                  <button
                    key={o.id || 'all'}
                    role="radio"
                    aria-checked={on}
                    title={`${o.label}  ⌘${i + 1}`}
                    onClick={() => switchAccount(o.id)}
                    className={cn(
                      'flex items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full transition-all duration-200',
                      on
                        ? 'bg-surface text-ink px-2.5 py-[3px] font-semibold shadow-sm'
                        : 'text-ink-muted hover:text-ink max-w-0 px-0 py-[3px] opacity-0 group-focus-within:max-w-[180px] group-focus-within:px-2.5 group-focus-within:opacity-100 group-hover:max-w-[180px] group-hover:px-2.5 group-hover:opacity-100',
                    )}
                  >
                    {o.color && <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: o.color }} />}
                    <span className="max-w-[140px] truncate">{o.label}</span>
                    {on && <ChevronDown size={12} className="text-ink-faint group-focus-within:hidden group-hover:hidden" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div ref={listRef} role="listbox" className="max-h-[56vh] overflow-y-auto pb-1">
          {rows.length === 0 && (
            <p className="text-ink-muted px-[22px] py-8 text-[13.5px]">
              {items.length || unreadItems.length
                ? 'Nothing here. ← → for the other tabs.'
                : 'New emails, unread mail and meeting alerts show up here.'}
            </p>
          )}
          {rows.map((row, i) => {
            const { item, section } = row;
            const header = i === 0 || rows[i - 1]!.section !== section;
            const count = header ? rows.filter((r) => r.section === section).length : 0;
            const on = item === active;
            const event = item.category === 'event';
            const subject = event ? item.title : item.body || '(no subject)';
            const preview = event ? eventLine(item) : item.snippet;
            const bold = section === 'unread' || markedUnread.has(item.id);
            return (
              <Fragment key={item.id}>
                {header && (
                  <div className="text-ink-faint flex items-center gap-2 px-[22px] pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.06em]">
                    <SectionIcon section={section} />
                    {LIST_SECTIONS.find((s) => s.id === section)!.label}
                    <span className="ml-auto font-medium normal-case tracking-normal tabular-nums">{count}</span>
                  </div>
                )}
                <button
                  role="option"
                  aria-selected={on}
                  data-active={on}
                  onMouseMove={() => setCursor(i)}
                  onClick={() => onOpen(item)}
                  className={cn(
                    'relative flex h-[42px] w-full items-center px-[22px] text-left text-[14px]',
                    on && 'bg-ink/[0.045]',
                  )}
                >
                  {on && <span className="bg-accent absolute bottom-[12px] left-2 top-[12px] w-[3px] rounded-full" />}
                  <span className="flex w-[170px] shrink-0 items-center gap-2 pr-4">
                    {multi && item.accountId && (
                      <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: colorOf(item.accountId) }} />
                    )}
                    <span className={cn('text-ink truncate', bold && 'font-semibold')}>
                      {event ? 'Calendar' : item.title || item.fromEmail || 'Unknown'}
                    </span>
                    {markedUnread.has(item.id) && <span className="bg-accent h-1.5 w-1.5 shrink-0 rounded-full" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    <span className={cn('text-ink', (item.priority || bold) && 'font-semibold')}>{subject}</span>
                    {preview && <span className="text-ink-faint ml-2.5">{preview}</span>}
                  </span>
                  <span className="text-ink-faint flex w-16 shrink-0 items-center justify-end gap-1.5 text-[12px] tabular-nums">
                    {item.kept && <Pin size={11} className="-rotate-45" aria-label="Kept" />}
                    {shortAgo(item.at, now)}
                  </span>
                </button>
              </Fragment>
            );
          })}
        </div>
        <div className="text-ink-faint flex justify-end gap-3.5 px-[18px] pt-2.5 text-[11px]">
          <span className="flex items-center gap-1.5">
            <Keycaps keys={['←', '→']} /> tabs
          </span>
          {multi && (
            <span className="flex items-center gap-1.5">
              <Keycaps keys={['⌘1', `⌘${Math.min(options.length, 9)}`]} /> account
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <Keycaps keys={['↩']} /> {active?.category === 'event' ? 'join' : 'open'}
          </span>
          <span className="flex items-center gap-1.5">
            <Keycaps keys={['K']} /> {active?.kept ? 'unkeep' : 'keep'}
          </span>
          <span className="flex items-center gap-1.5">
            <Keycaps keys={['U']} /> {active?.id.startsWith('u:') ? 'read' : 'unread'}
          </span>
          <span className="flex items-center gap-1.5">
            <Keycaps keys={['E']} /> done
          </span>
          <span className="flex items-center gap-1.5">
            <Keycaps keys={['esc']} /> close
          </span>
        </div>
      </div>
    </div>
  );
}
