import { EMPTY_AUTO_REPLY, type Account, type AutoReply, type AutoReplyState } from '@app/shared';
import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { useAccounts } from '../state/queries';
import { DateRangeCalendar } from './ui/DateRangeCalendar';

const inputCls =
  'rounded-lg border border-hairline bg-sunken px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-accent';

const DAY_MS = 86_400_000;

/** One-line state for the collapsed header: "On · until Nov 2", "Off". */
function summary(r: AutoReply): string {
  if (!r.enabled) return 'Off';
  const fmt = (ms: number) =>
    new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const now = Date.now();
  if (r.startMs != null && r.startMs > now) return `Scheduled from ${fmt(r.startMs)}`;
  if (r.endMs != null && r.endMs <= now) return 'Ended';
  return r.endMs != null ? `On · until ${fmt(r.endMs - DAY_MS)}` : 'On';
}

function AutoReplyCard({
  account,
  open,
  onToggle,
}: {
  account: Account;
  open: boolean;
  onToggle: () => void;
}) {
  const [state, setState] = useState<AutoReplyState | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [draft, setDraft] = useState<AutoReply>(EMPTY_AUTO_REPLY);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  const load = () =>
    void api.query('autoreply:get', { accountId: account.id }).then((s) => {
      setState(s);
      // Gmail's current settings are unknown: saving would overwrite them blind.
      setBlocked(s.mode === 'gmail' && !!s.error);
      setDraft(s.reply);
      setDirty(false);
    });
  // Reload when the auth scheme flips (a reconnect switches local → Gmail).
  useEffect(load, [account.id, account.authType]);

  if (!state) return null;
  const gmail = state.mode === 'gmail';
  const edit = (patch: Partial<AutoReply>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };

  const invalidRange = draft.startMs != null && draft.endMs != null && draft.endMs <= draft.startMs;
  const empty = !draft.subject.trim() && !draft.message.trim();

  const save = () => {
    setSaving(true);
    void api
      .command('autoreply:save', { accountId: account.id, reply: draft })
      .then((res) => {
        if (!res.ok) {
          setState((s) => s && { ...s, error: res.error, needsReconnect: res.needsReconnect });
          toast(res.error ?? 'Could not save the auto reply');
          return;
        }
        setDirty(false);
        setState((s) => s && { ...s, reply: draft, error: undefined, needsReconnect: false });
        toast(draft.enabled ? `Auto reply on for ${account.email}` : 'Auto reply saved');
      })
      .finally(() => setSaving(false));
  };

  const reconnect = () => {
    setReconnecting(true);
    void api
      .command('account:reconnect-google', { accountId: account.id })
      .then((res) => {
        if (!res.ok) toast(res.error ?? 'Google reconnect failed');
        else load();
      })
      .finally(() => setReconnecting(false));
  };

  const isGmailHost = account.imap.host === 'imap.gmail.com';

  return (
    <div className="border-hairline mb-3 rounded-xl border">
      <div className="flex items-center gap-3 px-3.5 py-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronDown
            size={14}
            className={cn(
              'text-ink-muted shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none',
              !open && '-rotate-90',
            )}
          />
          <span className="min-w-0">
            <span className="block truncate text-[12.5px] font-semibold">{account.email}</span>
            <span
              className={cn(
                'block text-[12px]',
                state.reply.enabled ? 'text-accent' : 'text-ink-muted',
              )}
            >
              {summary(state.reply)}
              {dirty && ' · unsaved changes'}
            </span>
          </span>
        </button>
        <label className="flex shrink-0 items-center gap-2 text-[12.5px] font-medium">
          <input
            type="checkbox"
            checked={draft.enabled}
            disabled={blocked}
            onChange={(e) => edit({ enabled: e.target.checked })}
          />
          On
        </label>
      </div>

      {/* 0fr → 1fr grid rows animate to the content's own height, no measuring. */}
      <div
        inert={!open}
        className={cn(
          'grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="px-3.5 pb-3.5">
            <p className="text-ink-muted text-[12px]">
              {gmail
                ? 'Uses Gmail’s vacation responder, so replies go out even while Uniox is closed.'
                : 'Uniox replies to new mail while it is running.'}
              {!gmail &&
                isGmailHost &&
                ' Connect Google in Accounts to let Gmail send them instead.'}
            </p>

            {state.error && (
              <div className="bg-sunken mt-3 flex items-center justify-between gap-3 rounded-lg px-2.5 py-2">
                <span className="text-danger text-[12px]">{state.error}</span>
                {state.needsReconnect && (
                  <button
                    disabled={reconnecting}
                    onClick={reconnect}
                    className="text-accent shrink-0 text-[12px] font-semibold hover:underline disabled:opacity-50"
                  >
                    {reconnecting ? 'Waiting for Google…' : 'Reconnect Google'}
                  </button>
                )}
              </div>
            )}

            <fieldset disabled={blocked} className="mt-3 flex flex-col gap-2.5 disabled:opacity-50">
              <DateRangeCalendar
                startMs={draft.startMs}
                endMs={draft.endMs}
                disabled={blocked}
                onChange={(range) => edit(range)}
              />
              <input
                value={draft.subject}
                onChange={(e) => edit({ subject: e.target.value })}
                placeholder={gmail ? 'Subject' : 'Subject (defaults to “Re: …” the original)'}
                className={inputCls}
              />
              <textarea
                value={draft.message}
                onChange={(e) => edit({ message: e.target.value })}
                placeholder="I’m away until Monday with limited access to email. For anything urgent, contact…"
                rows={5}
                className={cn(inputCls, 'resize-y')}
              />
              <label className="flex items-center gap-2 text-[12px]">
                <input
                  type="checkbox"
                  checked={draft.contactsOnly}
                  onChange={(e) => edit({ contactsOnly: e.target.checked })}
                />
                {gmail
                  ? 'Only send to people in my Google Contacts'
                  : 'Only send to people I’ve emailed before'}
              </label>
              <div className="flex items-center justify-between gap-3">
                <span className="text-ink-faint text-[11px]">
                  {invalidRange
                    ? 'The last day must be on or after the first day.'
                    : draft.enabled && empty
                      ? 'Add a subject or a message to turn it on.'
                      : 'Each sender gets at most one reply every 4 days. Lists and automated mail are skipped.'}
                </span>
                <button
                  onClick={save}
                  disabled={!dirty || saving || invalidRange || (draft.enabled && empty)}
                  className="bg-accent shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </fieldset>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Settings → Auto reply: one out-of-office responder per account. */
export function AutoReplyTab() {
  const { accounts } = useAccounts();
  // Collapsed by default; a lone account starts open since there is nothing to pick.
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return (
    <div>
      {accounts.map((a) => (
        <AutoReplyCard
          key={a.id}
          account={a}
          open={accounts.length === 1 || openIds.has(a.id)}
          onToggle={() => toggle(a.id)}
        />
      ))}
    </div>
  );
}
