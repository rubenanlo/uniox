import {
  Bell,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  LogOut,
  Moon,
  Palette,
  PenLine,
  Plus,
  Share,
  Sparkles,
  Sun,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AiKeyStatus } from '../data/api';
import { Toggle } from '../components/ui';
import { enablePush, isStandalone } from '../lib/push';
import { back, go, useRoute } from '../lib/router';
import { useStore } from '../lib/store';
import { useNow } from '../lib/useNow';

export function Settings() {
  const sub = useRoute().path[1];
  if (sub === 'appearance') return <Appearance />;
  if (sub === 'signatures') return <Signatures />;
  if (sub === 'ai-key') return <AiKey />;
  return <SettingsHome />;
}

function SettingsHome() {
  const { accounts, settings, saveSettings, api, showToast, me } = useStore();
  const [aiKey] = useAiKey();
  const now = useNow();
  const [pushBusy, setPushBusy] = useState(false);
  const palettes = [settings.palette, settings.paletteDark].map(
    (p) => p[0]!.toUpperCase() + p.slice(1),
  );

  const togglePush = async (on: boolean) => {
    if (!on) return void saveSettings({ pushEnabled: false });
    setPushBusy(true);
    try {
      const r = await enablePush(api);
      if (r === 'enabled') await saveSettings({ pushEnabled: true });
      else
        showToast({
          text:
            r === 'install'
              ? 'Add Uniox to your Home Screen first (Share → Add to Home Screen)'
              : r === 'denied'
                ? 'Notifications are blocked in iPhone Settings'
                : 'Push is not set up on the server yet',
        });
    } catch (e) {
      showToast({ text: (e as Error).message });
    } finally {
      setPushBusy(false);
    }
  };

  return (
    <div className="screen no-tabs settings-bg">
      <div className="navbar">
        <span />
        <button
          style={{ color: 'var(--accent)', fontSize: 17, fontWeight: 600, paddingRight: 6 }}
          onClick={() => back('home')}
        >
          Done
        </button>
      </div>
      <div className="pad">
        <div className="bigtitle">Settings</div>
      </div>

      <div className="glabel">Accounts</div>
      <div className="group">
        {accounts.map((a) => (
          <div key={a.id} className="gi" style={{ minHeight: 62 }}>
            <div
              className="av"
              style={{ background: a.color, width: 34, height: 34, fontSize: 13 }}
            >
              {a.email[0]!.toUpperCase()}
            </div>
            <div className="grow">
              <div className="ellipsis" style={{ fontSize: 15.5 }}>
                {a.email}
              </div>
              <div
                className="muted"
                style={{
                  fontSize: 12.5,
                  color: a.status === 'error' ? 'var(--danger)' : undefined,
                }}
              >
                Google ·{' '}
                {a.status === 'error'
                  ? 'sync problem, retrying every minute'
                  : a.status === 'syncing'
                    ? 'syncing…'
                    : a.lastSyncAt
                      ? `synced ${Math.max(0, Math.round((now - a.lastSyncAt) / 60_000))} min ago`
                      : 'synced'}
              </div>
            </div>
          </div>
        ))}
        <button
          className="gi"
          style={{ color: 'var(--accent)' }}
          onClick={() => void api.connectAccount()}
        >
          <span className="sq" style={{ color: 'var(--accent)' }}>
            <Plus size={20} />
          </span>
          Add Gmail account
        </button>
      </div>

      <div className="glabel">General</div>
      <div className="group">
        <button className="gi" onClick={() => go('settings/appearance')}>
          <span className="sq" style={{ background: '#7a5cf0' }}>
            <Palette size={17} />
          </span>
          Appearance
          <span className="v">
            {palettes[0] === palettes[1] ? palettes[0] : palettes.join(' / ')}{' '}
            <ChevronRight size={16} />
          </span>
        </button>
        <button className="gi" onClick={() => go('settings/signatures')}>
          <span className="sq" style={{ background: '#5a6170' }}>
            <PenLine size={17} />
          </span>
          Signatures
          <span className="v">
            <ChevronRight size={16} />
          </span>
        </button>
      </div>

      <div className="glabel">Notifications</div>
      <div className="group">
        <div className="gi">
          <span className="sq" style={{ background: '#ff3b30' }}>
            <Bell size={17} />
          </span>
          Push notifications
          <Toggle
            on={settings.pushEnabled && !pushBusy}
            onChange={(v) => void togglePush(v)}
            label="Push notifications"
          />
        </div>
        <div className="gi" style={{ display: 'block', padding: '10px 16px 12px 58px' }}>
          <div className="seg">
            <button
              className={settings.notifyMode === 'all' ? 'on' : ''}
              onClick={() => void saveSettings({ notifyMode: 'all' })}
            >
              All mail
            </button>
            <button
              className={settings.notifyMode === 'priority' ? 'on' : ''}
              onClick={() => void saveSettings({ notifyMode: 'priority' })}
            >
              Priority only
            </button>
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
            {settings.notifyMode === 'all'
              ? 'Every new email except newsletters and promotions.'
              : 'Only mail from people you write to and colleagues.'}
          </div>
        </div>
        {!isStandalone() && (
          <div
            className="gi"
            style={{
              fontSize: 13.5,
              color: 'var(--muted)',
              alignItems: 'flex-start',
              padding: '12px 16px',
            }}
          >
            <Share size={18} style={{ flex: 'none', marginTop: 1 }} />
            On iPhone, notifications need Uniox on your Home Screen: tap Share in Safari, then Add
            to Home Screen.
          </div>
        )}
      </div>

      <div className="glabel">AI</div>
      <div className="group">
        <div className="gi">
          <span
            className="sq"
            style={{ background: 'linear-gradient(135deg, var(--aqua), var(--violet))' }}
          >
            <Sparkles size={17} />
          </span>
          AI first read
          <Toggle
            on={settings.aiFirstRead}
            onChange={(v) => void saveSettings({ aiFirstRead: v })}
            label="AI first read"
          />
        </div>
        <button className="gi" onClick={() => go('settings/ai-key')}>
          <span className="sq" style={{ background: '#0a84ff' }}>
            <KeyRound size={17} />
          </span>
          Anthropic key
          <span className="v">
            {aiKey === null ? '' : aiKey.set ? `…${aiKey.hint}` : 'Add key'}
            <ChevronRight size={17} />
          </span>
        </button>
      </div>

      <div className="group" style={{ marginTop: 24 }}>
        <button
          className="gi"
          style={{ color: 'var(--danger)' }}
          onClick={() => void api.signOut().then(() => location.replace(location.pathname))}
        >
          <span className="sq" style={{ color: 'var(--danger)' }}>
            <LogOut size={19} />
          </span>
          Sign out {me?.email}
        </button>
      </div>
      <div className="muted" style={{ textAlign: 'center', fontSize: 12.5, marginTop: 18 }}>
        {api.kind === 'mock'
          ? 'Demo mode: sample data, nothing is sent'
          : 'Settings sync with your Uniox account'}
      </div>
    </div>
  );
}

/** Loads whether a key is stored. Null while loading or offline. */
function useAiKey(): [AiKeyStatus | null, (s: AiKeyStatus) => void] {
  const api = useStore((s) => s.api);
  const [status, setStatus] = useState<AiKeyStatus | null>(null);
  useEffect(() => {
    let live = true;
    void api
      .aiKey()
      .then((s) => {
        if (live) setStatus(s);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [api]);
  return [status, setStatus];
}

/** Add, replace or remove the user's own Anthropic key. */
function AiKey() {
  const { api, showToast } = useStore();
  const [status, setStatus] = useAiKey();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      setStatus(await api.setAiKey(key.trim()));
      setKey('');
      showToast({ text: 'Key saved' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await api.clearAiKey();
      setStatus({ set: false });
      showToast({ text: 'Key removed' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen no-tabs">
      <SubNav title="Anthropic key" />
      <div className="glabel">{status?.set ? 'Replace key' : 'Your key'}</div>
      <div className="group">
        <div className="gi">
          <input
            className="grow"
            type="password"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="sk-ant-…"
            aria-label="Anthropic API key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            style={{ fontSize: 16, height: 52 }}
          />
        </div>
      </div>
      {error && (
        <div style={{ color: 'var(--danger)', fontSize: 14, padding: '10px 20px 0' }} role="alert">
          {error}
        </div>
      )}
      <div style={{ padding: '16px 16px 0' }}>
        <button
          className="btn primary block"
          disabled={busy || key.trim().length < 20}
          onClick={() => void save()}
        >
          {busy ? 'Checking…' : status?.set ? 'Replace key' : 'Save key'}
        </button>
      </div>
      {status?.set && (
        <>
          <div className="glabel">Current key</div>
          <div className="group">
            <div className="gi">
              Ends in
              <span className="v">…{status.hint}</span>
            </div>
            <button
              className="gi"
              style={{ color: 'var(--danger)' }}
              disabled={busy}
              onClick={() => void remove()}
            >
              Remove key
            </button>
          </div>
        </>
      )}
      <div className="muted" style={{ fontSize: 13.5, lineHeight: 1.45, padding: '18px 20px' }}>
        AI features use your own Anthropic account. The key is sent once over an encrypted
        connection, stored encrypted on the server, and used only there to answer your requests. It
        is never sent back to this phone or shown again. Create one at console.anthropic.com under
        API keys.
      </div>
    </div>
  );
}

const LIGHT_THEMES = [
  ['default', 'Default', '#f6f6f4', '#2f63e7'],
  ['glacier', 'Glacier', '#edf1f7', '#4f46e5'],
  ['sage', 'Sage', '#edf0ea', '#2d7a58'],
  ['linen', 'Linen', '#f3eee5', '#c0532b'],
] as const;
const DARK_THEMES = [
  ['default', 'Default', '#141416', '#7fa2ff'],
  ['midnight', 'Midnight', '#0b1020', '#5cc8ff'],
  ['ember', 'Ember', '#17130f', '#ff9d5c'],
  ['aubergine', 'Aubergine', '#16101b', '#f28bc0'],
] as const;

function SubNav({ title }: { title: string }) {
  return (
    <div className="navbar" style={{ position: 'relative' }}>
      <button className="navbtn accent" onClick={() => back('settings')}>
        <ChevronLeft size={24} />
        <span style={{ fontSize: 17 }}>Settings</span>
      </button>
      <b style={{ fontSize: 17, position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>
        {title}
      </b>
      <span />
    </div>
  );
}

function Appearance() {
  const { settings, saveSettings } = useStore();
  const swatches = (
    list: typeof LIGHT_THEMES | typeof DARK_THEMES,
    key: 'palette' | 'paletteDark',
  ) => (
    <div
      className="group"
      style={{ padding: 14, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}
    >
      {list.map(([id, name, bg, ac]) => {
        const on = settings[key] === id;
        return (
          <button
            key={id}
            style={{ textAlign: 'center' }}
            onClick={() => void saveSettings({ [key]: id })}
          >
            <div
              style={{
                width: 62,
                height: 62,
                margin: '0 auto',
                borderRadius: 16,
                background: bg,
                border: on ? '2.5px solid var(--accent)' : '1px solid var(--hair)',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: 9,
                  top: 12,
                  width: 30,
                  height: 6,
                  borderRadius: 3,
                  background: ac,
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: 9,
                  top: 24,
                  width: 40,
                  height: 5,
                  borderRadius: 3,
                  background: key === 'paletteDark' ? '#ffffff30' : '#00000020',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: 9,
                  top: 34,
                  width: 32,
                  height: 5,
                  borderRadius: 3,
                  background: key === 'paletteDark' ? '#ffffff20' : '#00000014',
                }}
              />
            </div>
            <div style={{ fontSize: 12.5, marginTop: 5, fontWeight: on ? 600 : 400 }}>{name}</div>
          </button>
        );
      })}
    </div>
  );
  return (
    <div className="screen no-tabs settings-bg">
      <SubNav title="Appearance" />
      <div className="glabel" style={{ paddingTop: 12 }}>
        Mode
      </div>
      <div className="group" style={{ padding: 14, display: 'flex', gap: 10 }}>
        {(
          [
            ['light', 'Light', <Sun key="s" size={20} />],
            ['dark', 'Dark', <Moon key="m" size={20} />],
            ['auto', 'Auto', null],
          ] as const
        ).map(([k, label, icon]) => (
          <button
            key={k}
            style={{ flex: 1, textAlign: 'center' }}
            onClick={() => void saveSettings({ theme: k })}
          >
            <div
              style={{
                height: 74,
                borderRadius: 12,
                border: `2px solid ${settings.theme === k ? 'var(--accent)' : 'var(--hair)'}`,
                background:
                  k === 'light'
                    ? '#f6f6f4'
                    : k === 'dark'
                      ? '#1e1e21'
                      : 'linear-gradient(90deg, #f6f6f4 50%, #1e1e21 50%)',
                display: 'grid',
                placeItems: 'center',
                color: k === 'light' ? '#1c1c1f' : '#e8e8ec',
              }}
            >
              {icon}
            </div>
            <div
              style={{ fontSize: 14, marginTop: 6, fontWeight: settings.theme === k ? 600 : 400 }}
            >
              {label}
            </div>
          </button>
        ))}
      </div>
      <div className="glabel">Light theme</div>
      {swatches(LIGHT_THEMES, 'palette')}
      <div className="glabel">Dark theme</div>
      {swatches(DARK_THEMES, 'paletteDark')}
      <div className="glabel">AI surfaces</div>
      <div className="group" style={{ padding: '14px 16px' }}>
        <div className="row-flex" style={{ justifyContent: 'space-between', fontSize: 15.5 }}>
          <span>Liquid glass transparency</span>
          <span className="muted">{settings.glassTransparency}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={settings.glassTransparency}
          onChange={(e) => void saveSettings({ glassTransparency: Number(e.target.value) })}
          style={{ width: '100%', marginTop: 10, accentColor: 'var(--accent)' }}
          aria-label="Liquid glass transparency"
        />
        <div className="row-flex muted" style={{ justifyContent: 'space-between', fontSize: 12 }}>
          <span>Clear</span>
          <span>Frosted</span>
        </div>
        <div
          style={{
            position: 'relative',
            marginTop: 14,
            height: 96,
            borderRadius: 16,
            overflow: 'hidden',
            background: 'linear-gradient(135deg, #6f7bd9, #b98ad4 60%, #e0a3b8)',
          }}
        >
          <div
            className="glass row-flex"
            style={{
              position: 'absolute',
              inset: 14,
              borderRadius: 14,
              padding: '10px 12px',
              gap: 10,
              color: 'var(--ink)',
            }}
          >
            <span className="ai-mark">
              <Sparkles size={15} />
            </span>
            <span style={{ fontSize: 14 }}>Preview of an AI card</span>
          </div>
        </div>
      </div>
      <div className="glabel">Reading</div>
      <div className="group">
        <div className="gi">
          Thread layout
          <div className="seg" style={{ marginLeft: 'auto', width: 150 }}>
            <button
              className={settings.threadLayout === 'cards' ? 'on' : ''}
              onClick={() => void saveSettings({ threadLayout: 'cards' })}
            >
              Cards
            </button>
            <button
              className={settings.threadLayout === 'chat' ? 'on' : ''}
              onClick={() => void saveSettings({ threadLayout: 'chat' })}
            >
              Chat
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Signatures() {
  const { accounts, settings, saveSettings, showToast } = useStore();
  const [draft, setDraft] = useState<Record<string, string>>(settings.signatures);
  return (
    <div className="screen no-tabs settings-bg">
      <SubNav title="Signatures" />
      {accounts.map((a) => (
        <div key={a.id}>
          <div className="glabel" style={{ textTransform: 'none' }}>
            {a.email}
          </div>
          <div className="group">
            <textarea
              value={draft[a.email] ?? ''}
              placeholder="No signature"
              onChange={(e) => setDraft({ ...draft, [a.email]: e.target.value })}
              style={{
                width: '100%',
                minHeight: 110,
                padding: '12px 16px',
                fontSize: 15,
                lineHeight: 1.45,
                resize: 'vertical',
              }}
            />
          </div>
        </div>
      ))}
      <div className="pad" style={{ marginTop: 20 }}>
        <button
          className="btn primary block"
          onClick={() => {
            void saveSettings({ signatures: draft });
            showToast({ text: 'Signatures saved' });
          }}
        >
          Save
        </button>
      </div>
      <div className="muted" style={{ textAlign: 'center', fontSize: 12.5, margin: '14px 30px' }}>
        Added below your message when you send from the phone.
      </div>
    </div>
  );
}
