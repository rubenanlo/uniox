import { Inbox, Plus, Share } from 'lucide-react';
import { useState } from 'react';
import { isStandalone } from '../lib/push';
import { useRoute } from '../lib/router';
import { useStore } from '../lib/store';

export function Welcome() {
  const api = useStore((s) => s.api);
  const storeError = useStore((s) => s.error);
  const error = useRoute().query.get('error') ?? storeError;
  const [busy, setBusy] = useState(false);
  return (
    <>
      <div className="wash" style={{ opacity: 1 }} />
      <div className="screen no-tabs" style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ textAlign: 'center', marginTop: '14vh' }}>
          <div
            style={{
              width: 96,
              height: 96,
              margin: '0 auto',
              borderRadius: 24,
              background: 'linear-gradient(140deg, var(--aqua), var(--azure) 55%, var(--violet))',
              display: 'grid',
              placeItems: 'center',
              color: '#fff',
              boxShadow: '0 20px 40px -16px color-mix(in oklch, var(--azure) 70%, transparent)',
            }}
          >
            <Inbox size={46} strokeWidth={1.6} />
          </div>
          <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-.02em', marginTop: 24 }}>
            Uniox
          </div>
          <div
            className="muted"
            style={{ fontSize: 16, marginTop: 8, padding: '0 50px', lineHeight: 1.45 }}
          >
            Your mail, calendar and assistant. Same accounts as on your Mac.
          </div>
        </div>
        <div style={{ padding: '40px 20px 0' }}>
          {error && (
            <div
              style={{
                marginBottom: 14,
                padding: '10px 14px',
                borderRadius: 14,
                background: 'color-mix(in srgb, var(--danger) 12%, transparent)',
                color: 'var(--danger)',
                fontSize: 14,
              }}
            >
              {error}
            </div>
          )}
          <button
            className="btn primary block"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void api.signIn().catch((e) => {
                setBusy(false);
                useStore.setState({ error: (e as Error).message });
              });
            }}
          >
            {busy ? 'Opening Google…' : 'Continue with Google'}
          </button>
          {!isStandalone() && (
            <div
              className="glass"
              style={{ marginTop: 28, borderRadius: 22, padding: '14px 16px' }}
            >
              <b style={{ fontSize: 15 }}>Add Uniox to your Home Screen</b>
              <div className="muted" style={{ fontSize: 14, marginTop: 4, lineHeight: 1.45 }}>
                Needed for notifications and full screen. It takes two taps:
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 9,
                  marginTop: 12,
                  fontSize: 14.5,
                }}
              >
                <div className="row-flex" style={{ gap: 10 }}>
                  <span
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 9,
                      background: 'var(--accent-soft)',
                      color: 'var(--accent)',
                      display: 'grid',
                      placeItems: 'center',
                    }}
                  >
                    <Share size={17} />
                  </span>
                  Tap Share in Safari
                </div>
                <div className="row-flex" style={{ gap: 10 }}>
                  <span
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 9,
                      background: 'var(--accent-soft)',
                      color: 'var(--accent)',
                      display: 'grid',
                      placeItems: 'center',
                    }}
                  >
                    <Plus size={17} />
                  </span>
                  Choose “Add to Home Screen”
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
