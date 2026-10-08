import {
  DEFAULT_NOTIFY_SOUND,
  DEFAULT_SCHEDULING,
  normalizeAvailability,
  NOTIFY_SOUNDS,
  type AvailabilityPrefs,
  type NotifySound,
  type SchedulingPresets,
  type Template,
} from '@app/shared';
import {
  CalendarClock,
  FileText,
  Info,
  KanbanSquare,
  PenLine,
  Plus,
  Sparkles,
  Star,
  SunMoon,
  Trash2,
  UserRound,
  VolumeX,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { sanitizeSignatureHtml } from '@app/email-render';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { api } from '../lib/api';
import { minutesLabel } from '../lib/availability';
import { fileToAvatarDataUrl } from '../lib/avatar';
import {
  buildStyleProfile,
  forgetStyleProfile,
  loadStyleProfile,
  type StyleProfile,
} from '../lib/writingStyle';
import { ACCOUNT_SWATCHES, cn, defaultAccountColor, hueOf, initials } from '../lib/utils';
import { useAssistant } from '../state/assistant';
import { loadContactZones, saveContactZones, useZonePrompt } from '../state/contactZones';
import { normalizeSignatureHtml, signatureText } from '../lib/signature';
import { mutatePrioritySender } from '../state/priority';
import { useAccounts, useTemplates } from '../state/queries';
import { useUi, type ThemePref } from '../state/store';
import { AccountIcon } from './ui/AccountIcon';
import { ColorPicker } from './ui/ColorPicker';
import { SignatureEditor } from './SignatureEditor';
import { useShallow } from 'zustand/react/shallow';

type Tab =
  | 'appearance'
  | 'accounts'
  | 'priority'
  | 'scheduling'
  | 'signatures'
  | 'templates'
  | 'integrations'
  | 'assistant';

const SECTIONS: { id: Tab; label: string; icon: typeof SunMoon; blurb: string }[] = [
  {
    id: 'appearance',
    label: 'Appearance',
    icon: SunMoon,
    blurb: 'Set the theme and the accent color that tints the whole app.',
  },
  {
    id: 'accounts',
    label: 'Accounts',
    icon: UserRound,
    blurb: 'Give each account a picture and an unread-dot color to tell them apart.',
  },
  {
    id: 'priority',
    label: 'Priority',
    icon: Star,
    blurb: 'Emails from these senders always appear at the top of your inbox.',
  },
  {
    id: 'scheduling',
    label: 'Scheduling',
    icon: CalendarClock,
    blurb: 'Presets for Snooze, Reminders and Send Later, and when suggested meeting times can fall.',
  },
  {
    id: 'signatures',
    label: 'Signatures',
    icon: PenLine,
    blurb: 'Added to the end of new emails from each account. Leave empty for none.',
  },
  {
    id: 'templates',
    label: 'Templates',
    icon: FileText,
    blurb: 'Reusable emails you apply from the composer.',
  },
  {
    id: 'integrations',
    label: 'Integrations',
    icon: KanbanSquare,
    blurb: 'Connect the Notion Sprint board so Home can show your kanban and new requests.',
  },
  {
    id: 'assistant',
    label: 'Assistant',
    icon: Sparkles,
    blurb: 'Add a Claude API key to power the assistant orb — summaries, replies, and chat.',
  },
];

const AI_MODELS: { id: string; label: string }[] = [
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 (most capable)' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 (faster, cheaper)' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (fastest)' },
];

const inputCls =
  'rounded-lg border border-hairline bg-sunken px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-accent';

type NotifyMode = 'all' | 'smart' | 'off';

/** New-mail notification policy; the sync process reads this at ingest time. */
function NotificationsRow() {
  const [mode, setMode] = useState<NotifyMode>('all');
  useEffect(() => {
    void api.query('settings:get', { key: 'notifications' }).then((v) => {
      if (v === 'all' || v === 'smart' || v === 'off') setMode(v);
    });
  }, []);
  const pick = (m: NotifyMode) => {
    setMode(m);
    void api.command('settings:set', { key: 'notifications', value: m });
  };
  const options: { id: NotifyMode; label: string; hint: string }[] = [
    { id: 'all', label: 'All new mail', hint: 'Every new email notifies, like Mail or Gmail' },
    { id: 'smart', label: 'Important only', hint: 'Personal mail and invites from known senders' },
    { id: 'off', label: 'Off', hint: 'No new-mail notifications' },
  ];
  return (
    <Row label="Notifications">
      <div className="bg-sunken flex items-center rounded-lg p-0.5" role="radiogroup" aria-label="Notifications">
        {options.map((o) => (
          <button
            key={o.id}
            role="radio"
            aria-checked={mode === o.id}
            title={o.hint}
            onClick={() => pick(o.id)}
            className={cn(
              'rounded-md px-2.5 py-1 text-[12px]',
              mode === o.id ? 'bg-surface text-ink font-semibold shadow-sm' : 'text-ink-muted hover:text-ink',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </Row>
  );
}

/** Make Uniox the system's mail app, so clicked mailto: links open its composer. */
function DefaultMailAppRow() {
  const [isDefault, setIsDefault] = useState<boolean | null>(null);
  const check = () => void api.query('mailto:is-default', undefined).then(setIsDefault);
  useEffect(check, []);
  const makeDefault = () => {
    void api.command('mailto:make-default', undefined).then((res) => {
      if (!res.ok) toast(res.error ?? 'Could not make Uniox the default mail app');
      // macOS may ask for confirmation first; re-check once it has had a moment.
      setTimeout(check, 1500);
    });
  };
  return (
    <Field
      label="Default mail app"
      hint="Email links in your browser and other apps open a new message in Uniox."
    >
      {isDefault ? (
        <p className="text-ink-muted text-[12px]">Uniox is your default mail app.</p>
      ) : (
        <div>
          <button
            onClick={makeDefault}
            disabled={isDefault === null}
            className="bg-accent rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            Make Uniox the default mail app
          </button>
        </div>
      )}
    </Field>
  );
}

/** The new-mail chime. Selecting a sound plays it, so choosing is auditioning. */
function NotificationSoundField() {
  const [sound, setSound] = useState<NotifySound>(DEFAULT_NOTIFY_SOUND);
  useEffect(() => {
    void api.query('settings:get', { key: 'notificationSound' }).then((v) => {
      if (v === 'None' || (NOTIFY_SOUNDS as readonly string[]).includes(v as string)) {
        setSound(v as NotifySound);
      }
    });
  }, []);
  const pick = (s: NotifySound) => {
    setSound(s);
    void api.command('settings:set', { key: 'notificationSound', value: s });
    if (s !== 'None') void api.command('notify-sound:preview', { sound: s });
  };
  return (
    <Field label="New-mail sound" hint="Plays with the notification banner. Select a sound to hear it.">
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="New-mail sound">
        {(['None', ...NOTIFY_SOUNDS] as NotifySound[]).map((s) => (
          <button
            key={s}
            role="radio"
            aria-checked={sound === s}
            onClick={() => pick(s)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px]',
              sound === s
                ? 'border-accent bg-accent-soft text-accent font-semibold'
                : 'border-hairline bg-sunken text-ink-muted hover:text-ink',
            )}
          >
            {s === 'None' && <VolumeX size={12} />}
            {s === 'None' ? 'Silent' : s}
          </button>
        ))}
      </div>
    </Field>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="border-hairline flex items-center justify-between gap-4 border-b py-2.5 text-[12.5px] last:border-b-0">
      <span>{label}</span>
      {children}
    </label>
  );
}

/** A stacked field for controls that need room (e.g. a wrapping swatch row). */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-hairline flex flex-col gap-2.5 border-b py-3 last:border-b-0">
      <div>
        <p className="text-[12.5px] font-medium">{label}</p>
        {hint && <p className="text-ink-muted mt-0.5 text-[12px]">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

/** Claude API key + model for the assistant orb. The key is stored encrypted. */
function AssistantTab() {
  const [configured, setConfigured] = useState(false);
  const [model, setModel] = useState('claude-opus-4-8');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.query('ai:status', undefined).then((s) => {
      setConfigured(s.configured);
      setModel(s.model);
    });
  }, []);

  const saveKey = () => {
    const trimmed = key.trim();
    if (!trimmed) return;
    setBusy(true);
    void api
      .command('ai:config', { key: trimmed })
      .then((res) => {
        if (res.ok) {
          setConfigured(true);
          setKey('');
          useAssistant.getState().refreshStatus();
          toast('Claude API key saved');
        } else toast(res.error ?? 'Could not save the key');
      })
      .finally(() => setBusy(false));
  };

  const saveModel = (next: string) => {
    setModel(next);
    void api.command('ai:config', { model: next }).then(() => {
      useAssistant.getState().refreshStatus();
    });
  };

  return (
    <div className="space-y-1">
      <Field
        label="Claude API key"
        hint={
          configured
            ? 'A key is saved (encrypted on this device). Paste a new one to replace it.'
            : 'Create a key at console.anthropic.com, then paste it here. Stored encrypted, never leaves your machine except to call Claude.'
        }
      >
        <div className="flex gap-2">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveKey()}
            placeholder={configured ? 'sk-ant-… (replace)' : 'sk-ant-…'}
            aria-label="Claude API key"
            className={cn(inputCls, 'flex-1')}
          />
          <button
            onClick={saveKey}
            disabled={busy || !key.trim()}
            className="bg-accent rounded-lg px-3 text-[12.5px] font-semibold text-white disabled:opacity-40"
          >
            {configured ? 'Replace' : 'Save'}
          </button>
        </div>
      </Field>

      <Row label="Model">
        <select value={model} onChange={(e) => saveModel(e.target.value)} className={inputCls}>
          {AI_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </Row>

      <WritingStyleField configured={configured} />
    </div>
  );
}

/**
 * The per-account style profile behind the composer's "Rewrite in my style".
 * It is learned automatically on first use; this shows what was learned and
 * lets the user re-learn or forget it.
 */
function WritingStyleField({ configured }: { configured: boolean }) {
  const { accounts } = useAccounts();
  const [profiles, setProfiles] = useState<Record<string, StyleProfile | null>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all(accounts.map(async (a) => [a.id, await loadStyleProfile(a.id)] as const)).then(
      (rows) => setProfiles(Object.fromEntries(rows)),
    );
  }, [accounts]);

  const learn = (accountId: string) => {
    setBusy(accountId);
    void buildStyleProfile(accountId, useAssistant.getState().complete)
      .then((p) => {
        setProfiles((prev) => ({ ...prev, [accountId]: p }));
        toast(`Learned your style from ${p.sampleCount} sent emails`);
      })
      .catch((e) => toast(e instanceof Error ? e.message : 'Could not learn your style'))
      .finally(() => setBusy(null));
  };

  const forget = (accountId: string) => {
    void forgetStyleProfile(accountId).then(() =>
      setProfiles((prev) => ({ ...prev, [accountId]: null })),
    );
  };

  return (
    <Field
      label="Writing style"
      hint="“Rewrite in my style” learns how you write from each account's recent sent mail. It is learned on first use and refreshed every two weeks. Learning sends those emails to Claude with your key; the profile is saved on this device."
    >
      {accounts.map((a) => {
        const p = profiles[a.id];
        return (
          <div key={a.id} className="border-hairline rounded-xl border px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[12.5px] font-medium">{a.email}</p>
                <p className="text-ink-faint text-[11.5px]">
                  {p
                    ? `Learned from ${p.sampleCount} sent emails · ${new Date(p.builtAt).toLocaleDateString()}`
                    : 'Not learned yet'}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {p && (
                  <button
                    onClick={() => forget(a.id)}
                    className="text-ink-muted hover:text-danger text-[12px]"
                  >
                    Forget
                  </button>
                )}
                <button
                  onClick={() => learn(a.id)}
                  disabled={!configured || busy !== null}
                  className="text-accent text-[12px] font-semibold hover:underline disabled:opacity-40"
                >
                  {busy === a.id ? 'Learning…' : p ? 'Relearn' : 'Learn now'}
                </button>
              </div>
            </div>
            {p && (
              <details className="mt-1.5">
                <summary className="text-ink-muted hover:text-ink cursor-pointer text-[11.5px]">
                  What Uniox learned
                </summary>
                <p className="text-ink-muted mt-1.5 text-[12px] whitespace-pre-wrap">{p.guide}</p>
              </details>
            )}
          </div>
        );
      })}
    </Field>
  );
}

/** The display name Home greets you with. */
function NameRow() {
  const userName = useUi((s) => s.userName);
  const setUserName = useUi((s) => s.setUserName);
  const [draft, setDraft] = useState(userName ?? '');
  // Async-loaded name arriving after mount refreshes the field (render-time
  // derived-state adjustment, not an effect).
  const [seen, setSeen] = useState(userName);
  if (seen !== userName) {
    setSeen(userName);
    setDraft(userName ?? '');
  }
  const commit = () => {
    const name = draft.trim();
    setUserName(name || null);
    void api.command('settings:set', { key: 'userName', value: name });
  };
  return (
    <Row label="Your name">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        placeholder="How should we greet you?"
        aria-label="Your name"
        className={inputCls}
      />
    </Row>
  );
}

function AppearanceTab() {
  const { theme, setTheme } = useUi(useShallow((s) => ({ theme: s.theme, setTheme: s.setTheme })));
  const accentColor = useUi((s) => s.accentColor);
  const setAccentColor = useUi((s) => s.setAccentColor);
  const options: { id: ThemePref; label: string }[] = [
    { id: 'system', label: 'System' },
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
  ];
  return (
    <div>
      <NameRow />
      <Row label="Theme">
        <div
          className="bg-sunken flex items-center rounded-lg p-0.5"
          role="radiogroup"
          aria-label="Theme"
        >
          {options.map((o) => (
            <button
              key={o.id}
              role="radio"
              aria-checked={theme === o.id}
              onClick={() => setTheme(o.id)}
              className={cn(
                'rounded-md px-2.5 py-1 text-[12px]',
                theme === o.id
                  ? 'bg-surface text-ink font-semibold shadow-sm'
                  : 'text-ink-muted hover:text-ink',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </Row>
      <Field label="Accent color" hint="Tints buttons, links, and selected rows across the app.">
        <ColorPicker
          ariaLabel="Accent color"
          value={accentColor}
          defaultColor="#2f63e7"
          onSelect={(hex) => setAccentColor(hex)}
          onReset={() => setAccentColor(null)}
        />
      </Field>
      <DefaultMailAppRow />
      <NotificationsRow />
      <NotificationSoundField />
    </div>
  );
}

function AccountsTab() {
  const { accounts } = useAccounts();
  const accountAvatars = useUi((s) => s.accountAvatars);
  const setAccountAvatar = useUi((s) => s.setAccountAvatar);
  const accountColors = useUi((s) => s.accountColors);
  const setAccountColor = useUi((s) => s.setAccountColor);
  const [error, setError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  // Full disconnect: revokes the Google grant, forgets credentials, and deletes
  // the account's locally cached mail/calendar. Mail on the server is untouched.
  const remove = (accountId: string) => {
    setConfirmRemove(null);
    setRemoving(accountId);
    void api
      .command('account:remove', { accountId })
      .then((res) => {
        if (!res.ok) toast(res.error ?? 'Could not disconnect the account');
        else toast('Account disconnected');
      })
      .finally(() => setRemoving(null));
  };

  // Re-consent with Google (grants the calendar scope; upgrades app-password
  // accounts to OAuth). The browser opens for the consent screen.
  const reconnect = (accountId: string) => {
    setReconnecting(accountId);
    void api
      .command('account:reconnect-google', { accountId })
      .then((res) => {
        if (!res.ok) toast(res.error ?? 'Google reconnect failed');
        else if (res.warning) toast(res.warning);
        else
          toast(
            `Google connected — ${res.calendars} ${res.calendars === 1 ? 'calendar' : 'calendars'} visible`,
          );
      })
      .finally(() => setReconnecting(null));
  };

  const pick = (accountId: string, file: File | undefined) => {
    if (!file) return;
    fileToAvatarDataUrl(file).then(
      (dataUrl) => {
        setError(null);
        setAccountAvatar(accountId, dataUrl);
      },
      () => setError('Could not read that image — try a PNG or JPEG.'),
    );
  };

  // Closes settings and opens the add-account onboarding overlay.
  const addAccount = () => {
    useUi.getState().setSettingsOpen(false);
    useUi.getState().setAddingAccount(true);
  };

  return (
    <div>
      <button
        onClick={addAccount}
        className="text-accent hover:bg-accent-soft mb-1 flex items-center gap-1.5 rounded-lg py-2 text-[12.5px] font-semibold"
      >
        <Plus size={14} />
        Add another account
      </button>
      {accounts.map((a, i) => {
        const color = accountColors[a.id] ?? defaultAccountColor(i);
        return (
          <div
            key={a.id}
            className="border-hairline flex flex-col gap-3 border-b py-3.5 last:border-b-0"
          >
            <div className="flex items-center gap-3">
              <AccountIcon
                label={a.displayName || a.email}
                index={i}
                avatar={accountAvatars[a.id]}
                color={color}
                className="h-8 w-8 shrink-0 text-[12px]"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-semibold">{a.displayName}</p>
                <p className="text-ink-muted truncate text-[12px]">{a.email}</p>
              </div>
              <label className="text-accent cursor-pointer text-[12px] font-semibold hover:underline">
                Choose image…
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    pick(a.id, e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
              {accountAvatars[a.id] && (
                <button
                  onClick={() => setAccountAvatar(a.id, null)}
                  className="text-ink-muted hover:text-danger text-[12px] font-semibold"
                >
                  Remove
                </button>
              )}
            </div>
            <div className="flex justify-between gap-3 pl-11">
              <span className="text-ink-muted flex shrink-0 items-center gap-1.5 text-[12px]">
                <span className="h-2 w-2 rounded-full" style={{ background: color }} aria-hidden />
                Unread dot
              </span>
              <ColorPicker
                ariaLabel={`Unread dot color for ${a.displayName || a.email}`}
                value={accountColors[a.id] ?? null}
                defaultColor={defaultAccountColor(i)}
                swatches={ACCOUNT_SWATCHES}
                onSelect={(hex) => setAccountColor(a.id, hex)}
                onReset={() => setAccountColor(a.id, null)}
              />
            </div>
            {a.imap.host === 'imap.gmail.com' && (
              <div className="flex items-center justify-between gap-3 pl-11">
                <span className="text-ink-muted text-[12px]">
                  {a.authType === 'oauth-google'
                    ? 'Google connected via OAuth'
                    : 'Using an app password — connect Google for calendar access'}
                </span>
                <button
                  disabled={reconnecting === a.id}
                  onClick={() => reconnect(a.id)}
                  className="text-accent shrink-0 text-[12px] font-semibold hover:underline disabled:opacity-50"
                >
                  {reconnecting === a.id
                    ? 'Waiting for Google…'
                    : a.authType === 'oauth-google'
                      ? 'Reconnect Google'
                      : 'Connect Google'}
                </button>
              </div>
            )}
            <div className="flex items-center justify-between gap-3 pl-11">
              <span className="text-ink-muted text-[12px]">
                {confirmRemove === a.id
                  ? 'This deletes the locally cached mail and calendar. Server mail is untouched.'
                  : 'Disconnect this account from the app.'}
              </span>
              <button
                disabled={removing === a.id}
                onClick={() => (confirmRemove === a.id ? remove(a.id) : setConfirmRemove(a.id))}
                onBlur={() => setConfirmRemove((id) => (id === a.id ? null : id))}
                className="text-danger shrink-0 text-[12px] font-semibold hover:underline disabled:opacity-50"
              >
                {removing === a.id
                  ? 'Disconnecting…'
                  : confirmRemove === a.id
                    ? 'Click again to confirm'
                    : 'Disconnect'}
              </button>
            </div>
          </div>
        );
      })}
      {error && <p className="text-danger mt-2 text-[12px]">{error}</p>}
    </div>
  );
}

function PriorityTab() {
  const priorityEmails = useUi((s) => s.priorityEmails);
  const [draft, setDraft] = useState('');

  const add = () => {
    const emails = draft
      .split(/[,;\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.includes('@'));
    if (!emails.length) return;
    // Durable + synced: each add lands in the sync DB and (on Gmail) the
    // Uniox/Priority label, so other clients pick it up too.
    for (const email of emails) void mutatePrioritySender(email, true);
    setDraft('');
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder="name@example.com"
          aria-label="Priority email address"
          className={cn(inputCls, 'flex-1')}
        />
        <button
          onClick={add}
          disabled={!draft.includes('@')}
          className="bg-accent flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-40"
        >
          <Plus size={13} /> Add sender
        </button>
      </div>

      {priorityEmails.length === 0 ? (
        <div className="text-ink-muted flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
          <span className="bg-sunken flex h-10 w-10 items-center justify-center rounded-full">
            <Star size={17} className="text-ink-faint" />
          </span>
          <p className="text-[12.5px] font-semibold">No priority senders yet</p>
          <p className="text-ink-faint max-w-64 text-[12px]">
            Add an address above — its emails get their own Priority group above everything else.
          </p>
        </div>
      ) : (
        <div className="mt-3">
          <p className="text-ink-faint mb-1 px-1 font-mono text-[10px] font-semibold tracking-[0.14em] uppercase">
            Priority senders · {priorityEmails.length}
          </p>
          {priorityEmails.map((email) => (
            <div
              key={email}
              className="hover:bg-sunken group flex items-center gap-2.5 rounded-lg px-2 py-1.5"
            >
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                style={{ background: `hsl(${hueOf(email)} 55% 45%)` }}
                aria-hidden
              >
                {initials(email)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12.5px]">{email}</span>
              <button
                onClick={() => void mutatePrioritySender(email, false)}
                className="text-ink-muted hover:text-danger p-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                title={`Remove ${email} from priority senders`}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Where-do-I-get-the-OAuth-client walkthrough, opened from the info icon. */
function NotionSetupHelp({ onClose }: { onClose: () => void }) {
  // Capture-phase so this Escape closes only the modal, not the whole
  // settings sheet (whose useEscapeClose listens in the bubble phase).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const steps: React.ReactNode[] = [
    <>
      Go to <strong>notion.so/my-integrations</strong> (logged in as your SDSN workspace user).
    </>,
    <>
      Click <strong>+ New integration</strong>, name it (e.g. “Uniox”), pick the SDSN workspace,
      and save.
    </>,
    <>
      In the integration's settings, switch its type from <strong>Internal</strong> to{' '}
      <strong>Public</strong>. Notion asks for a company name, website, and privacy-policy URL —
      any real page you control works.
    </>,
    <>
      Under <strong>Redirect URIs</strong>, add exactly{' '}
      <code className="bg-sunken rounded px-1">http://localhost:21847/callback</code>.
    </>,
    <>
      Open the <strong>Secrets / OAuth credentials</strong> section and copy the{' '}
      <strong>OAuth client ID</strong> and <strong>OAuth client secret</strong> into the fields
      here, then press <strong>Connect to Notion</strong> and tick the WebDev Hub / Sprint board
      pages in the browser.
    </>,
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label="Notion setup instructions"
        className="border-hairline bg-surface w-[440px] max-w-[92vw] rounded-2xl border p-5 shadow-2xl"
      >
        <div className="flex items-center gap-2">
          <h3 className="text-ink flex-1 text-[13.5px] font-bold">Connecting the Sprint board</h3>
          <button onClick={onClose} aria-label="Close instructions" className="text-ink-muted hover:text-ink">
            <X size={15} />
          </button>
        </div>
        <ol className="text-ink-muted mt-3 list-decimal space-y-2 pl-5 text-[12px] leading-relaxed">
          {steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        <p className="text-ink-faint mt-3 text-[11.5px] leading-relaxed">
          If you don't see “OAuth client ID” in Notion, the integration is still Internal — the
          Public switch in step 3 is what reveals it. Internal integrations only have a single{' '}
          <code className="bg-sunken rounded px-1">ntn_…</code> token, which the manual setup below
          accepts instead.
        </p>
      </div>
    </div>
  );
}

/**
 * Notion Sprint board. Preferred path: browser OAuth — one click once the
 * OAuth client is saved; Notion's grant screen is where pages get shared.
 * Fallback: paste an internal-integration token (manual page sharing).
 */
function IntegrationsTab() {
  const [status, setStatus] = useState({ configured: false, hasClient: false });
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  useEffect(() => {
    void api.query('notion:status', undefined).then(setStatus);
  }, []);

  const connect = () => {
    setBusy(true);
    void api
      .command('notion:connect', {
        clientId: clientId || undefined,
        clientSecret: clientSecret || undefined,
      })
      .then((res) => {
        setBusy(false);
        if (res.ok) {
          setStatus({ configured: true, hasClient: true });
          setClientId('');
          setClientSecret('');
          setLastError(null);
          toast(`Notion connected${res.workspace ? ` — ${res.workspace}` : ''}`);
        } else {
          setLastError(res.error ?? 'Notion connection failed');
        }
      });
  };

  const saveToken = () => {
    setBusy(true);
    void api.command('notion:set-token', { token }).then((res) => {
      setBusy(false);
      if (res.ok) {
        setStatus((s) => ({ ...s, configured: true }));
        setToken('');
        toast('Notion connected — the Sprint board is now on Home');
      } else {
        toast(`Notion rejected the token: ${res.error ?? 'unknown error'}`);
      }
    });
  };

  return (
    <div>
      <Row label="Notion Sprint board">
        <span className="flex items-center gap-2">
          <span className={cn('text-[12px] font-semibold', status.configured ? 'text-emerald-500' : 'text-ink-faint')}>
            {status.configured ? 'Connected' : 'Not connected'}
          </span>
          <button
            onClick={() => setShowHelp(true)}
            title="How to set this up"
            aria-label="Notion setup instructions"
            className="text-ink-muted hover:text-accent"
          >
            <Info size={14} />
          </button>
        </span>
      </Row>
      {showHelp && <NotionSetupHelp onClose={() => setShowHelp(false)} />}

      {!status.hasClient && (
        <>
          <Row label="OAuth client ID">
            <input value={clientId} onChange={(e) => setClientId(e.target.value)}
              placeholder="from notion.so/my-integrations" aria-label="Notion OAuth client ID" className={inputCls} />
          </Row>
          <Row label="OAuth client secret">
            <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)}
              placeholder="secret_…" aria-label="Notion OAuth client secret" className={inputCls} />
          </Row>
        </>
      )}
      <Row label={status.configured ? 'Reauthorize' : 'Authorize'}>
        <button
          onClick={connect}
          disabled={busy || (!status.hasClient && (!clientId.trim() || !clientSecret.trim()))}
          className="bg-accent rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Waiting for Notion…' : 'Connect to Notion'}
        </button>
      </Row>
      {lastError && (
        <p className="text-danger mt-3 text-[11.5px] leading-relaxed" role="alert">
          {lastError}
        </p>
      )}
      <p className="text-ink-faint mt-3 text-[11.5px] leading-relaxed">
        Opens Notion in your browser to grant access — tick the WebDev Hub / Sprint board pages
        there; no manual sharing needed. One-time setup at notion.so/my-integrations: make the
        integration Public and register the redirect URI{' '}
        <code className="bg-sunken rounded px-1">http://localhost:21847/callback</code>. Everything
        is stored encrypted in the OS keychain.
      </p>

      <button onClick={() => setShowManual((v) => !v)} className="text-ink-faint hover:text-ink mt-4 text-[11.5px] underline">
        {showManual ? 'Hide manual setup' : 'Or paste an internal-integration token…'}
      </button>
      {showManual && (
        <div className="mt-2">
          <Row label="Integration token">
            <div className="flex items-center gap-2">
              <input type="password" value={token} onChange={(e) => setToken(e.target.value)}
                placeholder="ntn_… or secret_…" aria-label="Notion integration token" className={inputCls} />
              <button
                onClick={saveToken}
                disabled={busy || !token.trim()}
                className="bg-accent rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {busy ? 'Checking…' : 'Save'}
              </button>
            </div>
          </Row>
          <p className="text-ink-faint mt-2 text-[11.5px] leading-relaxed">
            For internal integrations: share the Sprint board with the integration in Notion
            (••• → Connections) before saving the token.
          </p>
        </div>
      )}
    </div>
  );
}

function SchedulingTab() {
  const [p, setP] = useState<SchedulingPresets>(DEFAULT_SCHEDULING);
  useEffect(() => {
    void api.query('settings:get', { key: 'scheduling' }).then((stored) => {
      if (stored) setP({ ...DEFAULT_SCHEDULING, ...(stored as Partial<SchedulingPresets>) });
    });
  }, []);
  const save = (next: SchedulingPresets) => {
    setP(next);
    void api.command('settings:set', { key: 'scheduling', value: next });
  };
  return (
    <div>
      <Row label="“Later today” waits">
        <select
          className={inputCls}
          value={p.laterTodayHours}
          onChange={(e) => save({ ...p, laterTodayHours: Number(e.target.value) })}
        >
          {[1, 2, 3, 4, 6].map((h) => (
            <option key={h} value={h}>
              {h} hour{h > 1 ? 's' : ''}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Morning starts at">
        <select
          className={inputCls}
          value={p.morningHour}
          onChange={(e) => save({ ...p, morningHour: Number(e.target.value) })}
        >
          {[6, 7, 8, 9, 10].map((h) => (
            <option key={h} value={h}>
              {h}:00
            </option>
          ))}
        </select>
      </Row>
      <Row label="Evening starts at">
        <select
          className={inputCls}
          value={p.eveningHour}
          onChange={(e) => save({ ...p, eveningHour: Number(e.target.value) })}
        >
          {[17, 18, 19, 20].map((h) => (
            <option key={h} value={h}>
              {h}:00
            </option>
          ))}
        </select>
      </Row>
      <Row label="Weekend begins">
        <select
          className={inputCls}
          value={p.weekendDay}
          onChange={(e) => save({ ...p, weekendDay: Number(e.target.value) as 6 | 0 })}
        >
          <option value={6}>Saturday</option>
          <option value={0}>Sunday</option>
        </select>
      </Row>
      <Row label="Notify when snoozed email returns">
        <input
          type="checkbox"
          checked={p.notify}
          onChange={(e) => save({ ...p, notify: e.target.checked })}
        />
      </Row>
      <AvailabilityWindow />
      <PeopleZones />
    </div>
  );
}

/** Half-hour steps from 6:00 to 22:00, as minutes after midnight. */
const HALF_HOURS = Array.from({ length: 33 }, (_, i) => 6 * 60 + i * 30);
/** Monday-first week (Date#getDay values). */
const WEEK = [
  [1, 'Mon'],
  [2, 'Tue'],
  [3, 'Wed'],
  [4, 'Thu'],
  [5, 'Fri'],
  [6, 'Sat'],
  [0, 'Sun'],
] as const;

/** The days and hours availability suggestions may offer (see AvailabilitySuggestions). */
function AvailabilityWindow() {
  const [a, setA] = useState<AvailabilityPrefs>(() => normalizeAvailability(null));
  useEffect(() => {
    void api.query('settings:get', { key: 'availability' }).then((v) => setA(normalizeAvailability(v)));
  }, []);
  const save = (next: AvailabilityPrefs) => {
    setA(next);
    void api.command('settings:set', { key: 'availability', value: next });
  };
  const toggleDay = (d: number) => {
    const days = a.weekdays.includes(d) ? a.weekdays.filter((x) => x !== d) : [...a.weekdays, d];
    if (!days.length) return void toast('Keep at least one day for suggested times.');
    save({ ...a, weekdays: days.sort((x, y) => x - y) });
  };
  return (
    <>
      <p className="text-ink-muted mt-5 mb-1 text-[11px] font-semibold tracking-wide uppercase">
        Suggested meeting times
      </p>
      <Row label="Earliest start">
        <select
          className={inputCls}
          value={a.startMinutes}
          onChange={(e) => save({ ...a, startMinutes: Number(e.target.value) })}
        >
          {HALF_HOURS.filter((m) => m < a.endMinutes).map((m) => (
            <option key={m} value={m}>
              {minutesLabel(m)}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Latest end">
        <select
          className={inputCls}
          value={a.endMinutes}
          onChange={(e) => save({ ...a, endMinutes: Number(e.target.value) })}
        >
          {HALF_HOURS.filter((m) => m > a.startMinutes).map((m) => (
            <option key={m} value={m}>
              {minutesLabel(m)}
            </option>
          ))}
        </select>
      </Row>
      <Field label="Days" hint="Times are offered on the next of each chosen day.">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days for suggested times">
          {WEEK.map(([d, name]) => (
            <button
              key={d}
              type="button"
              aria-pressed={a.weekdays.includes(d)}
              onClick={() => toggleDay(d)}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-[12px] font-medium',
                a.weekdays.includes(d)
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-hairline text-ink-muted hover:text-ink',
              )}
            >
              {name}
            </button>
          ))}
        </div>
      </Field>
    </>
  );
}

/** Time zones the user set for people whose calendar doesn't show one. */
function PeopleZones() {
  const version = useZonePrompt((s) => s.version);
  const [zones, setZones] = useState<[string, string][]>([]);
  useEffect(() => {
    void loadContactZones().then((z) => setZones(Object.entries(z).sort()));
  }, [version]);
  if (!zones.length) return null;
  return (
    <Field
      label="People’s time zones"
      hint="Set when you first offered them times. Used when their calendar doesn’t show a zone."
    >
      <ul className="space-y-1">
        {zones.map(([email, tz]) => (
          <li key={email} className="flex items-center gap-2 text-[12px]">
            <span className="flex-1 truncate">{email}</span>
            <span className="text-ink-muted">{tz.replace(/_/g, ' ')}</span>
            <button
              type="button"
              onClick={() => void saveContactZones({ [email]: null })}
              className="text-ink-faint hover:text-ink text-[11.5px] font-semibold"
            >
              Forget
            </button>
          </li>
        ))}
      </ul>
    </Field>
  );
}

function SignaturesTab() {
  const { accounts } = useAccounts();
  const [loaded, setLoaded] = useState<Record<string, string> | null>(null);
  const [bodies, setBodies] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  useEffect(() => {
    void api.query('signatures:list', undefined).then((sigs) => {
      const map: Record<string, string> = {};
      for (const s of sigs) map[s.id] = normalizeSignatureHtml(s.bodyHtml);
      setLoaded(map);
      setBodies(map);
    });
  }, []);
  const save = (accountId: string, name: string) => {
    const html = sanitizeSignatureHtml(bodies[accountId] ?? '');
    // An emptied box leaves "<br>" or empty divs behind: store that as no signature.
    const empty = !signatureText(html) && !/<img\b/i.test(html);
    void api
      .command('signatures:save', { id: accountId, name, bodyHtml: empty ? '' : html })
      .then(() => {
        setDirty((prev) => ({ ...prev, [accountId]: false }));
        toast('Signature saved');
      });
  };
  if (!loaded) return null;
  return (
    <div>
      <p className="text-ink-muted mb-4 text-[12px]">
        Copy your signature from another mail app, a document or a website and paste it below.
        Images, links, fonts and colors come along.
      </p>
      {accounts.map((a) => (
        <div key={a.id} className="mb-5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[12.5px] font-semibold">{a.email}</span>
            <button
              onClick={() => save(a.id, a.email)}
              className={cn(
                'text-[12px] font-semibold hover:underline',
                dirty[a.id] ? 'text-accent' : 'text-ink-faint',
              )}
            >
              Save
            </button>
          </div>
          <SignatureEditor
            initialHtml={loaded[a.id] ?? ''}
            placeholder={`Paste your signature for ${a.displayName || a.email}`}
            onChange={(html) => {
              setBodies((prev) => ({ ...prev, [a.id]: html }));
              setDirty((prev) => ({ ...prev, [a.id]: true }));
            }}
          />
        </div>
      ))}
    </div>
  );
}

function TemplatesTab() {
  const { templates, refresh } = useTemplates();
  const [editing, setEditing] = useState<Template | null>(null);

  const blank = (): Template => ({
    id: crypto.randomUUID(),
    name: '',
    subject: '',
    bodyHtml: '',
    to: [],
    cc: [],
    bcc: [],
  });

  if (editing) {
    return (
      <div className="flex flex-col gap-2">
        <input
          autoFocus
          value={editing.name}
          onChange={(e) => setEditing({ ...editing, name: e.target.value })}
          placeholder="Template name"
          className={cn(inputCls, 'font-semibold')}
        />
        <input
          value={editing.subject}
          onChange={(e) => setEditing({ ...editing, subject: e.target.value })}
          placeholder="Subject"
          className={inputCls}
        />
        <textarea
          value={editing.bodyHtml}
          onChange={(e) => setEditing({ ...editing, bodyHtml: e.target.value })}
          placeholder="<p>Hi {name},</p><p>…</p>  — {name} fills from the To field; other {placeholders} are asked for at send"
          rows={8}
          className={cn(inputCls, 'resize-y font-mono text-[11.5px]')}
        />
        <div className="flex gap-2">
          <button
            disabled={!editing.name}
            onClick={() => {
              void api.command('templates:save', editing).then(() => {
                refresh();
                setEditing(null);
              });
            }}
            className="bg-accent rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
          >
            Save template
          </button>
          <button
            onClick={() => setEditing(null)}
            className="text-ink-muted text-[12px] hover:underline"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {templates.length === 0 ? (
        <div className="text-ink-muted flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
          <span className="bg-sunken flex h-10 w-10 items-center justify-center rounded-full">
            <FileText size={17} className="text-ink-faint" />
          </span>
          <p className="text-[12.5px] font-semibold">No templates yet</p>
          <p className="text-ink-faint max-w-64 text-[12px]">
            Write an email once, apply it from the composer whenever you need it.
          </p>
        </div>
      ) : (
        <div>
          {templates.map((t) => (
            <div
              key={t.id}
              className="hover:bg-sunken group flex items-center gap-2 rounded-lg px-2 py-1.5"
            >
              <button onClick={() => setEditing(t)} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-[12.5px] font-semibold">{t.name}</span>
                <span className="text-ink-faint block truncate text-[11px]">
                  {t.subject || 'no subject'}
                </span>
              </button>
              <button
                onClick={() => void api.command('templates:delete', { id: t.id }).then(refresh)}
                className="text-ink-muted hover:text-danger p-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                title="Delete template (cannot be undone)"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <p className="text-ink-faint mt-2 px-2 text-[11px]">
            <code className="font-mono">{'{name}'}</code> auto-fills from the first recipient.
          </p>
        </div>
      )}
      <button
        onClick={() => setEditing(blank())}
        className="text-accent mt-3 flex items-center gap-1.5 self-start text-[12.5px] font-semibold hover:underline"
      >
        <Plus size={13} /> New template
      </button>
    </div>
  );
}

/** Focus a section in the rail; with no id, the current one. */
function focusRail(id?: Tab) {
  const sel = id ? `[data-settings-section="${id}"]` : '[data-settings-section][aria-current]';
  (document.querySelector(sel) as HTMLElement | null)?.focus();
}

function contentFocusables(): HTMLElement[] {
  const root = document.querySelector('[data-settings-content]');
  if (!root) return [];
  return [
    ...root.querySelectorAll<HTMLElement>(
      'button, a[href], input, select, textarea, [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((el) => !el.matches(':disabled') && el.offsetParent !== null);
}

/** Controls whose own behavior needs the arrow keys. */
function ownsArrows(el: HTMLElement | null): boolean {
  if (!el) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName !== 'INPUT') return false;
  const type = (el as HTMLInputElement).type;
  return !['checkbox', 'button', 'submit', 'reset', 'color', 'file'].includes(type);
}

export function SettingsSheet() {
  const { settingsOpen, setSettingsOpen } = useUi(
    useShallow((s) => ({ settingsOpen: s.settingsOpen, setSettingsOpen: s.setSettingsOpen })),
  );
  const [tab, setTab] = useState<Tab>('appearance');
  useEscapeClose(settingsOpen, () => setSettingsOpen(false));

  // On open, put focus on the current section so arrows work right away.
  useEffect(() => {
    if (settingsOpen) focusRail();
  }, [settingsOpen]);

  // Arrows pressed while focus has fallen out of the dialog (e.g. after a
  // click on blank space) land back on the section rail.
  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.key.startsWith('Arrow')) return;
      if ((e.target as HTMLElement | null)?.closest?.('[data-settings-dialog]')) return;
      e.preventDefault();
      focusRail();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settingsOpen]);

  if (!settingsOpen) return null;

  const section = SECTIONS.find((s) => s.id === tab)!;

  // ↑/↓ walk the section rail, matching the app's mailbox sidebar;
  // → / ↩ step into the section's content.
  const onRailKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      contentFocusables()[0]?.focus();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    e.stopPropagation();
    const idx = SECTIONS.findIndex((s) => s.id === tab);
    const next =
      SECTIONS[Math.min(SECTIONS.length - 1, Math.max(0, idx + (e.key === 'ArrowDown' ? 1 : -1)))]!;
    setTab(next.id);
    focusRail(next.id);
  };

  // Inside a section, ↑/↓ step between controls and ← returns to the rail.
  // Fields that use arrows themselves (text, selects, sliders) keep them.
  const onContentKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'ArrowLeft') return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || ownsArrows(e.target as HTMLElement)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'ArrowLeft') {
      focusRail(tab);
      return;
    }
    const items = contentFocusables();
    const idx = items.indexOf(document.activeElement as HTMLElement);
    const next = items[idx + (e.key === 'ArrowDown' ? 1 : -1)];
    next?.focus();
    next?.scrollIntoView({ block: 'nearest' });
  };

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/30"
      onMouseDown={() => setSettingsOpen(false)}
    >
      <div
        role="dialog"
        aria-label="Settings"
        data-settings-dialog
        onMouseDown={(e) => e.stopPropagation()}
        className="border-hairline bg-surface flex h-[440px] max-h-[85vh] w-[640px] max-w-[92vw] overflow-hidden rounded-2xl border shadow-2xl"
      >
        {/* section rail — same vocabulary as the app's mailbox sidebar */}
        <nav
          aria-label="Settings sections"
          onKeyDown={onRailKeyDown}
          className="border-hairline bg-app w-40 shrink-0 border-r p-2"
        >
          <h2 className="px-2.5 pt-1 pb-2 text-[13px] font-bold">Settings</h2>
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              data-settings-section={id}
              onClick={() => setTab(id)}
              aria-current={tab === id || undefined}
              className={cn(
                'mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[12.5px]',
                tab === id
                  ? 'bg-accent-soft text-accent font-semibold'
                  : 'text-ink-muted hover:bg-sunken hover:text-ink focus-visible:bg-sunken focus-visible:text-ink',
              )}
            >
              <Icon size={15} strokeWidth={2.2} className="shrink-0" />
              {label}
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="border-hairline flex items-start gap-3 border-b px-5 pt-4 pb-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-[14px] leading-tight font-bold">{section.label}</h3>
              <p className="text-ink-muted mt-0.5 text-[12px]">{section.blurb}</p>
            </div>
            <button
              onClick={() => setSettingsOpen(false)}
              aria-label="Close settings"
              className="text-ink-muted hover:bg-sunken hover:text-ink -mr-1 rounded-md p-1.5"
            >
              <X size={15} />
            </button>
          </header>
          <div
            data-settings-content
            onKeyDown={onContentKeyDown}
            className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
          >
            {tab === 'appearance' && <AppearanceTab />}
            {tab === 'accounts' && <AccountsTab />}
            {tab === 'priority' && <PriorityTab />}
            {tab === 'scheduling' && <SchedulingTab />}
            {tab === 'signatures' && <SignaturesTab />}
            {tab === 'templates' && <TemplatesTab />}
            {tab === 'integrations' && <IntegrationsTab />}
            {tab === 'assistant' && <AssistantTab />}
          </div>
        </div>
      </div>
    </div>
  );
}
