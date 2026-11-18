import type { Account, QuickReplyItem, QuickReplyView } from '@app/shared';
import { Bell, Check, ChevronDown, Inbox, Pin } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
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
  VIEW_LABEL,
  type ListRow,
  type ListSection,
  type ListTab,
} from '../../lib/quickReply';
import { cn } from '../../lib/utils';
import { useUi } from '../../state/store';
import { Keycaps } from '../ui/Keycap';
import { useListMotion } from './useListMotion';

function eventLine(item: QuickReplyItem): string {
  const when = item.startMs
    ? `Starts ${new Date(item.startMs).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
    : 'Meeting';
  return item.location ? `${when} · ${item.location}` : when;
}

function SectionIcon({ section }: { section: ListSection }) {
  if (section === 'kept') return <Pin size={12} className="-rotate-45" />;
  if (section === 'new') return <Bell size={12} />;
  if (section === 'read') return <Inbox size={12} />;
  return <span className="bg-accent h-[7px] w-[7px] rounded-full" />;
}

/**
 * ⌥⌘N: emails you kept, the notifications from the last day, then the rest of
 * your unread mail and (in the whole-inbox view) the read mail still in the
 * inbox, filed under Important, Calendar, Docs and Other. The control at the
 * top right ("Inbox · All accounts") opens one menu for the view (⌥⌘N again
 * flips it) and the account (⌘1 All, ⌘2… each account, as in the main window). ←/→ (or Tab / ⇧Tab) switch tabs, ↑/↓ move, ↩ opens the email
 * in the reply widget (or joins a meeting), K keeps it here after it's read,
 * U toggles unread, E marks it done, ⌫ drops a notification from the list.
 *
 * Nothing here marks mail read: only opening an email (↩) does.
 */
export function NotificationList({
  items,
  inboxItems,
  view,
  accounts,
  startId,
  onOpen,
  onClose,
}: {
  items: QuickReplyItem[];
  /** Inbox threads, read and unread. Loaded by the window before it fades in, so the first open doesn't pop rows in. */
  inboxItems: QuickReplyItem[];
  view: QuickReplyView;
  accounts: Account[];
  startId: string | null;
  onOpen: (item: QuickReplyItem) => void;
  onClose: () => void;
}) {
  const colorOf = useAccountColor();
  const multi = accounts.length > 1;
  const accountLabels = useUi((s) => s.accountLabels);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [tab, setTab] = useState<ListTab>(() => startTab(items, startId));

  const rowsByTab = useMemo(() => {
    const m = {} as Record<ListTab, ListRow[]>;
    for (const t of LIST_TABS) m[t.id] = listRows(items, inboxItems, t.id, accountId || undefined, view);
    return m;
  }, [items, inboxItems, accountId, view]);
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
  useListMotion(listRef, `${tab}|${accountId}|${view}`, rows.map((r) => r.item.id).join('\n'));

  // Say what ⌥⌘N just did (the list stays mounted while open, so this skips the first render).
  const firstView = useRef(view);
  useEffect(() => {
    if (view === firstView.current) return;
    firstView.current = view;
    toast(view === 'unread' ? 'Unread only · ⌥⌘N for the whole inbox' : 'Whole inbox · ⌥⌘N for unread only');
  }, [view]);

  useEffect(() => {
    if (!menuOpen) return;
    const away = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', away, true);
    return () => window.removeEventListener('mousedown', away, true);
  }, [menuOpen]);

  const setView = (v: QuickReplyView) => void api.command('quick-reply:view', { view: v });

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
      // An inbox thread: U marks unread mail read (in the unread view it then
      // leaves the list unless kept) and read mail unread again (its latest message).
      if (!item.threadId) return;
      const read = item.unread !== false;
      void api.query('thread:messages', { threadId: item.threadId }).then((msgs) => {
        const mine = msgs.filter((m) => m.accountId === item.accountId);
        const ids = read ? mine.filter((m) => !m.seen).map((m) => m.id) : mine.slice(-1).map((m) => m.id);
        if (ids.length) void api.command('task:enqueue', { type: 'set-seen', accountId: item.accountId!, messageIds: ids, seen: read });
      });
      toast(read ? 'Marked as read' : 'Marked as unread');
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
        if (menuOpen) setMenuOpen(false);
        else onClose();
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
    accounts.map((a) => ({
      id: a.id,
      label: accountLabels[a.id] || a.displayName || a.email,
      color: colorOf(a.id),
    })),
  );
  const current = options.find((o) => o.id === accountId) ?? options[0]!;

  return (
    <div
      role="dialog"
      aria-label="Notifications"
      className="qr-glass qr-enter absolute left-1/2 top-[14vh] w-[820px] max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-[20px] pb-2.5 pt-1.5"
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
          {/* One control for what the list shows: the view, and (with several accounts) the account. */}
          <div ref={menuRef} className="relative mb-0 ml-auto">
            <button
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
              className="text-ink flex items-center gap-1.5 whitespace-nowrap pb-2.5 text-[14.5px] font-medium"
            >
              {VIEW_LABEL[view]}
              {multi && (
                <>
                  <span className="text-ink-faint">·</span>
                  {current.color && <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: current.color }} />}
                  <span className="max-w-[180px] truncate">{current.label}</span>
                </>
              )}
              <ChevronDown size={13} className={cn('text-ink-faint transition-transform', menuOpen && 'rotate-180')} />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="bg-surface border-ink/8 absolute right-[-8px] top-full z-20 mt-1 w-[240px] rounded-xl border p-1.5 text-[13.5px] shadow-[0_18px_40px_-12px_rgb(0_0_0/0.35)]"
              >
                <div className="text-ink-faint px-2.5 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em]">Show</div>
                {(['inbox', 'unread'] as const).map((v) => (
                  <button
                    key={v}
                    role="menuitemradio"
                    aria-checked={view === v}
                    onClick={() => {
                      setView(v);
                      setMenuOpen(false);
                    }}
                    className="text-ink hover:bg-ink/[0.05] flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left"
                  >
                    <Check size={13} className={cn('shrink-0', view !== v && 'invisible')} />
                    {v === 'inbox' ? 'Whole inbox' : 'Unread only'}
                    {view !== v && <span className="ml-auto"><Keycaps keys={['⌥⌘N']} /></span>}
                  </button>
                ))}
                {multi && (
                  <>
                    <div className="border-ink/8 mx-1 my-1.5 border-t" />
                    <div className="text-ink-faint px-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.06em]">Account</div>
                    {options.map((o, i) => (
                      <button
                        key={o.id || 'all'}
                        role="menuitemradio"
                        aria-checked={o.id === current.id}
                        onClick={() => {
                          switchAccount(o.id);
                          setMenuOpen(false);
                        }}
                        className="text-ink hover:bg-ink/[0.05] flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left"
                      >
                        <Check size={13} className={cn('shrink-0', o.id !== current.id && 'invisible')} />
                        {o.color && <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: o.color }} />}
                        <span className="truncate">{o.label}</span>
                        {i < 9 && <span className="ml-auto"><Keycaps keys={[`⌘${i + 1}`]} /></span>}
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div ref={listRef} role="listbox" className="relative max-h-[56vh] overflow-y-auto pb-1">
          {rows.length === 0 && (
            <p data-motion="empty" className="text-ink-muted px-[22px] py-8 text-[13.5px]">
              {items.length || inboxItems.length
                ? view === 'unread'
                  ? 'Nothing unread here. ⌥⌘N for the whole inbox.'
                  : 'Nothing here. ← → for the other tabs.'
                : 'New emails, your inbox and meeting alerts show up here.'}
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
                  <div
                    data-motion={`h:${section}`}
                    className="text-ink-faint flex items-center gap-2 px-[22px] pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.06em]">
                    <SectionIcon section={section} />
                    {LIST_SECTIONS.find((s) => s.id === section)!.label}
                    <span className="ml-auto font-medium normal-case tracking-normal tabular-nums">{count}</span>
                  </div>
                )}
                <button
                  role="option"
                  aria-selected={on}
                  data-active={on}
                  data-motion={item.id}
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
            <Keycaps keys={['⌥⌘N']} /> {view === 'inbox' ? 'unread only' : 'whole inbox'}
          </span>
          <span className="flex items-center gap-1.5">
            <Keycaps keys={['↩']} /> {active?.category === 'event' ? 'join' : 'open'}
          </span>
          <span className="flex items-center gap-1.5">
            <Keycaps keys={['K']} /> {active?.kept ? 'unkeep' : 'keep'}
          </span>
          <span className="flex items-center gap-1.5">
            <Keycaps keys={['U']} /> {active?.id.startsWith('u:') && active.unread !== false ? 'read' : 'unread'}
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
