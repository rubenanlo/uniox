import { EMPTY_AUTO_REPLY, type Account, type AutoReply, type AutoReplyState } from '@app/shared';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { useAccounts } from '../state/queries';

const inputCls =
  'rounded-lg border border-hairline bg-sunken px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-accent';

const DAY_MS = 86_400_000;

/** Local midnight ↔ <input type="date"> value. */
function toDateInput(ms: number | null): string {
  if (ms == null) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromDateInput(value: string): number | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y!, m! - 1, d!).getTime();
}

/** endMs is the midnight after the last day away; the picker shows that last day. */
const lastDayInput = (endMs: number | null) => toDateInput(endMs == null ? null : endMs - DAY_MS);
function endFromLastDay(value: string): number | null {
  const ms = fromDateInput(value);
  if (ms == null) return null;
  const next = new Date(ms);
  next.setDate(next.getDate() + 1); // calendar day, so DST changes don't shift it
  return next.getTime();
}

function AutoReplyCard({ account }: { account: Account }) {
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
    <div className="border-hairline mb-4 rounded-xl border p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-semibold">{account.email}</p>
          <p className="text-ink-muted mt-0.5 text-[12px]">
            {gmail
              ? 'Uses Gmail’s vacation responder, so replies go out even while Uniox is closed.'
              : 'Uniox replies to new mail while it is running.'}
            {!gmail && isGmailHost && ' Connect Google in Accounts to let Gmail send them instead.'}
          </p>
        </div>
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
        <div className="grid grid-cols-2 gap-2.5">
          <label className="flex flex-col gap-1 text-[12px]">
            <span className="text-ink-muted">First day</span>
            <input
              type="date"
              value={toDateInput(draft.startMs)}
              onChange={(e) => edit({ startMs: fromDateInput(e.target.value) })}
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px]">
            <span className="text-ink-muted">Last day (optional)</span>
            <input
              type="date"
              value={lastDayInput(draft.endMs)}
              onChange={(e) => edit({ endMs: endFromLastDay(e.target.value) })}
              className={inputCls}
            />
          </label>
        </div>
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
  );
}

/** Settings → Auto reply: one out-of-office responder per account. */
export function AutoReplyTab() {
  const { accounts } = useAccounts();
  return (
    <div>
      {accounts.map((a) => (
        <AutoReplyCard key={a.id} account={a} />
      ))}
    </div>
  );
}
