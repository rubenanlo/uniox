import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  // A tapped notification opens its thread: by message when the app is awake,
  // or from the note the service worker leaves when it comes forward or starts.
  const openUrl = (url: string) => {
    const hash = url.replace(/^[^#]*/, '');
    if (hash && location.hash !== hash) location.hash = hash;
  };
  const takeNote = async () => {
    try {
      const box = await caches.open('uniox-open');
      const res = await box.match('./__open');
      if (!res) return;
      await box.delete('./__open');
      const { url, at } = (await res.json()) as { url?: string; at?: number };
      if (url && at && Date.now() - at < 5 * 60_000) openUrl(url);
    } catch {
      /* no note */
    }
  };
  navigator.serviceWorker.addEventListener(
    'message',
    (e: MessageEvent<{ type?: string; url?: string }>) => {
      if (e.data?.type === 'open' && e.data.url) {
        openUrl(e.data.url);
        void takeNote();
      }
    },
  );
  void takeNote();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void takeNote();
  });
  window.addEventListener('focus', () => void takeNote());
  window.addEventListener('pageshow', () => void takeNote());
}
