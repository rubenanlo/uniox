import { AtSign, ChevronDown, Loader2, Mail } from 'lucide-react';
import { useEffect, useState } from 'react';
import { GMAIL_ENDPOINTS, type AccountConfig } from '@app/shared';
import { api } from '../lib/api';
import { cn } from '../lib/utils';

const isPackaged = api.isPackaged;

const DEV_PRESET: Omit<AccountConfig, 'email' | 'displayName'> = {
  imap: { host: '127.0.0.1', port: 1143, secure: false, allowInsecureTls: true },
  smtp: { host: '127.0.0.1', port: 1025, secure: false, allowInsecureTls: true },
};

const inputCls =
  'w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-[13px] placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-accent';

function GmailPanel({ onAdded, prefillAppPassword }: { onAdded: () => void; prefillAppPassword: () => void }) {
  const [status, setStatus] = useState<{ hasClient: boolean; builtIn: boolean } | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [showSetup, setShowSetup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.command('account:google-status', undefined).then(setStatus);
  }, []);

  // Half-filled custom fields never travel: both or neither.
  const pasting = !!clientId && !!clientSecret;

  const connect = async () => {
    setError(null);
    setBusy(true);
    const result = await api.command('account:add-google', {
      clientId: pasting ? clientId : undefined,
      clientSecret: pasting ? clientSecret : undefined,
    });
    setBusy(false);
    if (result.ok) onAdded();
    else setError(result.error);
  };

  const needsClient = status?.hasClient === false && !pasting;
  const showClientFields = status !== null && (!status.hasClient || showAdvanced);

  return (
    <div className="flex flex-col gap-2.5">
      {status?.hasClient && (
        <button
          onClick={() => setShowAdvanced((v) => !v)}
          className="text-ink-muted hover:text-ink flex items-center gap-1 self-start text-[12px]"
        >
          <ChevronDown size={12} className={cn('transition-transform', showAdvanced && 'rotate-180')} />
          Advanced: use your own OAuth client
        </button>
      )}
      {showClientFields && (
        <>
          <div className="grid grid-cols-1 gap-2.5">
            <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="OAuth client ID (…apps.googleusercontent.com)" className={inputCls} aria-label="Google OAuth client ID" />
            <input value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="OAuth client secret" className={inputCls} aria-label="Google OAuth client secret" />
          </div>
          <button
            onClick={() => setShowSetup((v) => !v)}
            className="text-ink-muted hover:text-ink flex items-center gap-1 self-start text-[12px]"
          >
            <ChevronDown size={12} className={cn('transition-transform', showSetup && 'rotate-180')} />
            How to create the OAuth client (one-time, ~3 minutes)
          </button>
          {showSetup && (
            <ol className="text-ink-muted list-decimal space-y-1 pl-5 text-[12px]">
              <li>
                Open{' '}
                <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="text-accent underline">
                  console.cloud.google.com/apis/credentials
                </a>{' '}
                and create (or pick) a project.
              </li>
              <li>Configure the OAuth consent screen: External, add yourself under Test users, and add the scopes <code className="font-mono">https://mail.google.com/</code> and <code className="font-mono">…/auth/calendar</code>. “Testing” status is fine — no verification needed for your own account.</li>
              <li>Create credentials → OAuth client ID → type “Desktop app”.</li>
              <li>Copy the client ID and secret here. They’re stored encrypted in your keychain.</li>
            </ol>
          )}
        </>
      )}
      {status?.hasClient && !showAdvanced && (
        <p className="text-ink-muted text-[12px]">
          {status.builtIn
            ? 'Google opens in the browser — pick your account and click Allow. Mail and calendar connect in one step.'
            : 'Your saved OAuth client will be used. Google opens in the browser to authorize the account.'}
        </p>
      )}
      {error && <p className="text-danger text-[12px]">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          onClick={() => void connect()}
          disabled={busy || needsClient}
          className={cn(
            'bg-accent flex h-9 items-center gap-2 rounded-lg px-4 text-[13px] font-semibold text-white',
            busy || needsClient ? 'opacity-60' : 'hover:opacity-90',
          )}
        >
          {busy && <Loader2 size={14} className="animate-spin" />}
          {busy ? 'Finish sign-in in your browser…' : 'Sign in with Google'}
        </button>
        <button onClick={prefillAppPassword} className="text-ink-muted hover:text-ink text-[12px] underline">
          Use an app password instead
        </button>
      </div>
      <p className="text-ink-faint text-[11.5px]">
        App password: enable 2-step verification, generate one at myaccount.google.com/apppasswords, and use it with the IMAP form — no cloud project needed.
      </p>
    </div>
  );
}

export function Onboarding({ onAdded, canDismiss, onDismiss }: { onAdded: () => void; canDismiss?: boolean; onDismiss?: () => void }) {
  const [provider, setProvider] = useState<'imap' | 'gmail'>('imap');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [imapHost, setImapHost] = useState('');
  const [imapPort, setImapPort] = useState('993');
  const [imapSecure, setImapSecure] = useState(true);
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [allowInsecure, setAllowInsecure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyGmailPreset = () => {
    setImapHost(GMAIL_ENDPOINTS.imap.host);
    setImapPort(String(GMAIL_ENDPOINTS.imap.port));
    setImapSecure(true);
    setSmtpHost(GMAIL_ENDPOINTS.smtp.host);
    setSmtpPort(String(GMAIL_ENDPOINTS.smtp.port));
    setAllowInsecure(false);
  };

  const applyDevPreset = () => {
    setImapHost(DEV_PRESET.imap.host);
    setImapPort(String(DEV_PRESET.imap.port));
    setImapSecure(false);
    setSmtpHost(DEV_PRESET.smtp.host);
    setSmtpPort(String(DEV_PRESET.smtp.port));
    setAllowInsecure(true);
    if (!email) setEmail('alice@dev.local');
    if (!password) setPassword('pass');
  };

  const submit = async () => {
    setError(null);
    if (!email.includes('@') || !password || !imapHost || !smtpHost) {
      setError('Email, password, and both servers are required.');
      return;
    }
    setBusy(true);
    const config: AccountConfig = {
      email,
      displayName: displayName || email.split('@')[0],
      imap: { host: imapHost, port: Number(imapPort), secure: imapSecure, allowInsecureTls: allowInsecure },
      smtp: { host: smtpHost, port: Number(smtpPort), secure: false, allowInsecureTls: allowInsecure },
    };
    const result = await api.command('account:add', { config, password });
    setBusy(false);
    if (result.ok) onAdded();
    else setError(result.error);
  };

  return (
    <div className="bg-app flex h-full items-center justify-center overflow-y-auto">
      <div className="w-[460px] max-w-[92vw] py-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="bg-accent flex h-10 w-10 items-center justify-center rounded-xl text-white">
            <Mail size={20} />
          </div>
          <div>
            <h1 className="text-[16px] font-bold tracking-tight">Add a mail account</h1>
            <p className="text-ink-muted text-[12px]">
              Everything stays on this machine — credentials go to the OS keychain, mail to a local database.
            </p>
          </div>
        </div>

        {/* provider tiles */}
        <div className="mb-5 grid grid-cols-4 gap-2">
          <button
            onClick={() => setProvider('imap')}
            className={cn(
              'rounded-xl border px-2 py-2.5 text-[11.5px] font-semibold',
              provider === 'imap' ? 'border-accent bg-accent-soft text-accent' : 'border-hairline text-ink-muted hover:text-ink',
            )}
            title="Any IMAP server"
          >
            <AtSign size={15} className="mx-auto mb-1" />
            IMAP
          </button>
          <button
            onClick={() => setProvider('gmail')}
            className={cn(
              'rounded-xl border px-2 py-2.5 text-[11.5px] font-semibold',
              provider === 'gmail' ? 'border-accent bg-accent-soft text-accent' : 'border-hairline text-ink-muted hover:text-ink',
            )}
            title="Gmail via Google sign-in or app password"
          >
            <Mail size={15} className="mx-auto mb-1" />
            Gmail
          </button>
          {(['Microsoft 365', 'iCloud'] as const).map((p) => (
            <button
              key={p}
              disabled
              title={`${p} arrives once OAuth app registration completes`}
              className="border-hairline text-ink-faint cursor-not-allowed rounded-xl border px-2 py-2.5 text-[11.5px]"
            >
              {p}
              <span className="block text-[9.5px]">soon</span>
            </button>
          ))}
        </div>

        {provider === 'gmail' ? (
          <GmailPanel
            onAdded={onAdded}
            prefillAppPassword={() => {
              applyGmailPreset();
              setProvider('imap');
            }}
          />
        ) : (
        <div className="flex flex-col gap-2.5">
          <div className="grid grid-cols-2 gap-2.5">
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" className={inputCls} aria-label="Display name" />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className={inputCls} aria-label="Email address" />
          </div>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password or app-specific password"
            className={inputCls}
            aria-label="Password"
          />
          <div className="grid grid-cols-[1fr_84px] gap-2.5">
            <input value={imapHost} onChange={(e) => setImapHost(e.target.value)} placeholder="IMAP server (imap.example.com)" className={inputCls} aria-label="IMAP host" />
            <input value={imapPort} onChange={(e) => setImapPort(e.target.value)} className={inputCls} aria-label="IMAP port" />
          </div>
          <div className="grid grid-cols-[1fr_84px] gap-2.5">
            <input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="SMTP server (smtp.example.com)" className={inputCls} aria-label="SMTP host" />
            <input value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} className={inputCls} aria-label="SMTP port" />
          </div>
          <div className="text-ink-muted flex items-center gap-4 text-[12px]">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={imapSecure} onChange={(e) => setImapSecure(e.target.checked)} />
              IMAP over TLS (993)
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={allowInsecure} onChange={(e) => setAllowInsecure(e.target.checked)} />
              Accept self-signed certs (dev)
            </label>
          </div>

          {error && <p className="text-danger text-[12px]">{error}</p>}

          <div className="mt-1 flex items-center gap-3">
            <button
              onClick={submit}
              disabled={busy}
              className={cn(
                'bg-accent flex h-9 items-center gap-2 rounded-lg px-4 text-[13px] font-semibold text-white',
                busy ? 'opacity-60' : 'hover:opacity-90',
              )}
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              {busy ? 'Checking connection…' : 'Add account'}
            </button>
            {!isPackaged && (
              <button onClick={applyDevPreset} className="text-ink-muted hover:text-ink text-[12px] underline">
                Use local dev server
              </button>
            )}
            {canDismiss && (
              <button onClick={onDismiss} className="text-ink-muted hover:text-ink ml-auto text-[12px]">
                Cancel
              </button>
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
