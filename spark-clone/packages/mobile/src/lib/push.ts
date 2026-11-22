import type { UnioxApi } from '../data/api';

/** iOS only allows Web Push for apps added to the Home Screen. */
export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function urlB64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Asks for permission (must run from a tap) and registers this device. */
export async function enablePush(
  api: UnioxApi,
): Promise<'enabled' | 'denied' | 'unsupported' | 'install'> {
  if (!pushSupported()) return isStandalone() ? 'unsupported' : 'install';
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (!key && api.kind === 'supabase') return 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'denied';
  if (api.kind === 'mock') return 'enabled';
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(key!),
    }));
  await api.registerPush(sub.toJSON());
  return 'enabled';
}
