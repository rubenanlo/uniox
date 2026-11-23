/* Uniox service worker: app-shell cache (offline launch) and Web Push. */
const CACHE = 'uniox-shell-v1';
// Holds the thread a tapped notification should open, until the app reads it.
const OPEN = 'uniox-open';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(['./', './index.html', './manifest.webmanifest']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE && k !== OPEN).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

// Network first for the page, cache first for built assets; never cache API calls.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && /\/assets\/|\/icons\//.test(url.pathname)) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});

self.addEventListener('push', (e) => {
  let data;
  try {
    data = e.data ? e.data.json() : {};
  } catch {
    data = { title: 'Uniox', body: e.data ? e.data.text() : '' };
  }
  e.waitUntil(
    self.registration.showNotification(data.title || 'Uniox', {
      body: data.body || '',
      tag: data.tag,
      data: { url: data.url || './#/inbox' },
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './#/inbox', self.registration.scope).href;
  e.waitUntil(
    (async () => {
      // iOS often drops a message to a suspended app, or opens the start page
      // instead of the URL; the app also reads this note when it comes forward.
      const box = await caches.open(OPEN);
      await box.put('./__open', new Response(JSON.stringify({ url, at: Date.now() })));
      const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const win = list[0];
      if (win) {
        win.postMessage({ type: 'open', url });
        try {
          await win.focus();
        } catch {
          /* focus can be refused; the note still opens the thread */
        }
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
