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
  // A tapped notification asks the app to open a thread.
  navigator.serviceWorker.addEventListener(
    'message',
    (e: MessageEvent<{ type?: string; url?: string }>) => {
      if (e.data?.type === 'open' && e.data.url) location.hash = e.data.url.replace(/^.*#/, '#');
    },
  );
}
