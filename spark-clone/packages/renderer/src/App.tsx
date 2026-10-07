import type { ThreadSummary } from '@app/shared';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { toast, Toaster } from 'sonner';
import { KeymapProvider } from './actions/KeymapProvider';
import { CommandCenter } from './components/CommandCenter';
import { Composer } from './components/composer/Composer';
import { GatekeeperCard } from './components/GatekeeperCard';
import { CalendarView } from './components/calendar/CalendarView';
import { HomeView } from './components/HomeView';
import { ThreadList } from './components/list/ThreadList';
import { Onboarding } from './components/Onboarding';
import { Intro } from './components/intro/Intro';
import { AssistantModal } from './components/orb/AssistantModal';
import { OrbCorner } from './components/orb/OrbCorner';
import { OutboxView } from './components/OutboxView';
import { EmptyReadingPane, ThreadView } from './components/reading/ThreadView';
import { SchedulePicker } from './components/SchedulePicker';
import { SettingsSheet } from './components/SettingsSheet';
import { ShortcutsSheet } from './components/ShortcutsSheet';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { api } from './lib/api';
import { fmtWake } from './lib/schedule';
import { softTint } from './lib/utils';
import { useAssistant, wireAssistant } from './state/assistant';
import { wireCalendar } from './state/calendar';
import { wireKanban } from './state/kanban';
import { usePersistedUiPrefs } from './state/persist';
import { useAccounts, useDelta, useSelectedThread, useThreads } from './state/queries';
import { useUi } from './state/store';
import { useShallow } from 'zustand/react/shallow';

function useTheme() {
  const theme = useUi((s) => s.theme);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', dark);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

/**
 * A custom accent overrides --color-accent everywhere (buttons, links, the
 * unread rail) via an inline var, which wins over the theme's stylesheet value.
 * accent-soft is derived so selected-row tints follow along in both themes.
 * Clearing it hands control back to the theme.
 */
function useAccentColor() {
  const accentColor = useUi((s) => s.accentColor);
  useEffect(() => {
    const root = document.documentElement.style;
    if (accentColor) {
      root.setProperty('--color-accent', accentColor);
      root.setProperty('--color-accent-soft', softTint(accentColor));
    } else {
      root.removeProperty('--color-accent');
      root.removeProperty('--color-accent-soft');
    }
  }, [accentColor]);
}

/**
 * Home's "new since you were last here" line: read the last-active time saved
 * by the previous session as this session's baseline, then keep re-saving so the
 * next launch knows when we left. Reading before the first write keeps the
 * baseline pinned to the prior session even across a crash.
 */
/** Load the persisted display name into the store; Settings/Home update both. */
function useUserName() {
  useEffect(() => {
    void api.query('settings:get', { key: 'userName' }).then((v) => {
      if (typeof v === 'string' && v.trim()) useUi.getState().setUserName(v.trim());
    });
  }, []);
}

/** Resolve whether the first-run intro splash has already played. */
function useIntroSeen() {
  useEffect(() => {
    void api.query('settings:get', { key: 'intro:seen' }).then((v) => {
      useUi.getState().setIntroSeen(v === true);
    });
  }, []);
}

function useHomeBaseline() {
  useEffect(() => {
    let cancelled = false;
    void api.query('settings:get', { key: 'home:lastActive' }).then((v) => {
      if (!cancelled && typeof v === 'number') useUi.getState().setHomeBaseline(v);
    });
    const write = () =>
      void api.command('settings:set', { key: 'home:lastActive', value: Date.now() });
    const id = window.setInterval(write, 30_000);
    window.addEventListener('beforeunload', write);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener('beforeunload', write);
    };
  }, []);
}

/**
 * Return to Home after a stretch of inactivity, so the app rests on the
 * briefing screen. Composing pauses the timer — we never yank someone out of a
 * half-written message.
 */
function useIdleHome(idleMs = 30 * 60 * 1000) {
  useEffect(() => {
    let timer: number | undefined;
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const s = useUi.getState();
        if (s.composer) return arm(); // still busy — check again later
        if (s.view !== 'home') s.setView('home');
      }, idleMs);
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, arm, { passive: true }));
    arm();
    return () => {
      window.clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, arm));
    };
  }, [idleMs]);
}

function ListPane({ threads }: { threads: ThreadSummary[] }) {
  const view = useUi((s) => s.view);
  return (
    <div className="flex h-full flex-col">
      {view === 'inbox' && <GatekeeperCard />}
      <div className="min-h-0 flex-1">
        <ThreadList threads={threads} />
      </div>
    </div>
  );
}

function MailView() {
  const { view, accountFilter, searchQuery, split, selectedThreadId, selectThread } = useUi(
    useShallow((s) => ({
      view: s.view,
      accountFilter: s.accountFilter,
      searchQuery: s.searchQuery,
      split: s.split,
      selectedThreadId: s.selectedThreadId,
      selectThread: s.selectThread,
    })),
  );
  const { threads } = useThreads({ view, accountId: accountFilter, search: searchQuery });
  const inList = useMemo(
    () => threads.find((t) => t.id === selectedThreadId) ?? null,
    [threads, selectedThreadId],
  );
  // Gatekeeper cards open mail from senders the list is still screening out.
  const selected = useSelectedThread(selectedThreadId, inList);

  // Esc steps back: reading a thread in single pane returns to the list, an
  // active search returns to the unfiltered list, a category drill-in (e.g.
  // Newsletters) returns to the inbox, and from the
  // list itself it returns to the Home briefing. Capture phase so we
  // read state *before* any open overlay's own Esc handler closes it — if one
  // is up, we bail and let it own the key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      )
        return;
      const s = useUi.getState();
      if (s.composer || s.commandOpen || s.settingsOpen || s.shortcutsOpen || s.picker) return;
      if (useAssistant.getState().open) return; // the modal's own Esc closes it
      e.preventDefault();
      e.stopPropagation();
      if (s.selectedThreadId && !s.split) {
        s.selectThread(null); // back out of the open thread to the list
        return;
      }
      if (s.searchQuery) {
        s.setSearchQuery(''); // close the committed search, back to the list as it was
        return;
      }
      if (s.categoryFocus) {
        s.setCategoryFocus(null); // back out of the category drill-in to the inbox
        return;
      }
      s.setView('home');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  if (view === 'outbox') {
    return (
      <div className="h-full min-w-0 flex-1">
        <OutboxView />
      </div>
    );
  }

  if (!split) {
    return selected ? (
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <button
          onClick={() => selectThread(null)}
          className="text-ink-muted hover:text-ink flex items-center gap-1.5 px-4 py-2 text-[12px]"
        >
          <ArrowLeft size={13} /> Back to list
        </button>
        <div className="min-h-0 flex-1">
          <ThreadView key={selected.id} thread={selected} />
        </div>
      </div>
    ) : (
      <div className="h-full min-w-0 flex-1">
        <ListPane threads={threads} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-1">
      <div className="border-hairline h-full w-[360px] shrink-0 border-r">
        <ListPane threads={threads} />
      </div>
      <div className="h-full min-w-0 flex-1">
        {selected ? <ThreadView key={selected.id} thread={selected} /> : <EmptyReadingPane />}
      </div>
    </div>
  );
}

function ThreadSchedulePicker() {
  const { picker, closePicker } = useUi(
    useShallow((s) => ({ picker: s.picker, closePicker: s.closePicker })),
  );
  if (!picker) return null;
  const { kind, thread } = picker;
  return (
    <SchedulePicker
      title={
        kind === 'snooze' ? `Snooze “${thread.subject || 'this email'}”` : 'Remind me about this'
      }
      icon={kind === 'snooze' ? 'snooze' : 'remind'}
      someday={kind === 'snooze'}
      notifyToggle={kind === 'snooze'}
      onClose={closePicker}
      onPick={(when, notify) => {
        closePicker();
        if (kind === 'snooze') {
          void api.command('task:enqueue', {
            type: 'snooze-thread',
            accountId: thread.accountId,
            threadId: thread.id,
            wakeAt: when,
            alert: notify,
          });
          toast(when === null ? 'Snoozed until someday' : `Snoozed — back ${fmtWake(when)}`);
        } else if (when !== null) {
          void api.command('task:enqueue', {
            type: 'set-reminder',
            accountId: thread.accountId,
            threadId: thread.id,
            remindAt: when,
          });
          toast(`Reminder set for ${fmtWake(when)}`);
        }
      }}
    />
  );
}

export default function App() {
  usePersistedUiPrefs();
  useTheme();
  useAccentColor();
  useHomeBaseline();
  useUserName();
  useIntroSeen();
  useIdleHome();
  // Notion Sprint-board polling lives app-level so the sidebar dot works
  // from any view.
  useEffect(() => wireKanban(), []);
  // Assistant stream channel + initial status probe, app-level.
  useEffect(() => wireAssistant(), []);
  // Calendar change-delta subscription + initial load, app-level.
  useEffect(() => wireCalendar(), []);
  // Clicking a system notification lands on that email (or the calendar
  // for meeting alerts).
  useDelta((e) => {
    if (e.kind === 'open-thread') {
      const ui = useUi.getState();
      ui.setView('inbox');
      ui.selectThread(e.threadId);
    } else if (e.kind === 'open-calendar') {
      useUi.getState().setView('calendar');
    }
  });
  const { accounts, loaded, refresh } = useAccounts();
  const { composer, view } = useUi(useShallow((s) => ({ composer: s.composer, view: s.view })));
  const searching = useUi((s) => !!s.searchQuery.trim());
  const addingAccount = useUi((s) => s.addingAccount);
  const setAddingAccount = useUi((s) => s.setAddingAccount);
  const introSeen = useUi((s) => s.introSeen);

  if (!loaded || introSeen === null) {
    return (
      <div className="text-ink-faint flex h-full items-center justify-center text-[13px]">
        Starting…
      </div>
    );
  }

  // First launch: play the intro once, then fall through to onboarding/app.
  if (introSeen === false) {
    return (
      <Intro
        onDone={() => {
          useUi.getState().setIntroSeen(true);
          void api.command('settings:set', { key: 'intro:seen', value: true });
        }}
      />
    );
  }

  if (accounts.length === 0 || addingAccount) {
    return (
      <Onboarding
        onAdded={() => {
          setAddingAccount(false);
          refresh();
        }}
        canDismiss={accounts.length > 0}
        onDismiss={() => setAddingAccount(false)}
      />
    );
  }

  return (
    <KeymapProvider>
      {/* The daylight glow is the shell backdrop everywhere; bars, list, and
          reading pane are transparent so it runs edge to edge. */}
      <div className="home-glow relative flex h-full flex-col">
        {view !== 'calendar' && <TopBar />}
        <div className="relative flex min-h-0 flex-1">
          <Sidebar onAddAccount={() => setAddingAccount(true)} />
          <main className="flex h-full min-w-0 flex-1 flex-col">
            {/* A search always needs somewhere to land: Home and Calendar
                render no thread list, so typing a query there used to run the
                search and show nothing. Clearing it (Esc) returns here. */}
            {searching ? (
              <MailView />
            ) : view === 'home' ? (
              <HomeView />
            ) : view === 'calendar' ? (
              <CalendarView onAddAccount={() => setAddingAccount(true)} />
            ) : (
              <MailView />
            )}
          </main>
        </div>
        {/* decorative corner orb; the composer (z-40) slides over it */}
        <OrbCorner />
        <AssistantModal />

        {composer && (
          <Composer
            key={`${composer.mode}-${composer.replyTo?.id ?? composer.draftMessage?.id ?? 'new'}`}
            state={composer}
          />
        )}
        <CommandCenter />
        <ShortcutsSheet />
        <SettingsSheet />
        <ThreadSchedulePicker />
        <Toaster
          position="bottom-left"
          // Toasts wear the app's own surface tokens, so they sit naturally on
          // the glow backdrop and flip with the light/dark theme.
          toastOptions={{
            style: {
              fontSize: '12.5px',
              borderRadius: '12px',
              background: 'var(--color-surface)',
              color: 'var(--color-ink)',
              border: '1px solid var(--color-hairline)',
              boxShadow: '0 8px 28px rgb(0 0 0 / 0.28)',
            },
            actionButtonStyle: {
              background: 'var(--color-accent)',
              color: '#fff',
            },
          }}
        />
      </div>
    </KeymapProvider>
  );
}
