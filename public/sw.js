const CACHE = 'swifthaul-shell-v5';
const SCOPE = self.registration.scope;
const ASSETS = ['app.css', 'icon.svg', 'icon-192.png', 'icon-512.png', 'offline.html', 'location-picker.js', 'driver-dash.css', 'driver-dash-offline.js']
  .map(name => new URL(name, SCOPE).pathname);
const OFFLINE = new URL('offline.html', SCOPE).pathname;
self.addEventListener('install', event => {event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));self.skipWaiting();});
self.addEventListener('activate', event => {event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))));self.clients.claim();});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Account, Identity, booking data and third-party requests always go to the network.
  if (url.origin !== self.location.origin || event.request.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));return;
  }
  if (ASSETS.includes(url.pathname)) event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = { body: event.data?.text() || '' }; }
  const title = String(payload.title || 'SwiftHaul SA');
  const options = {
    body: String(payload.body || 'You have a delivery update.'),
    icon: new URL('icon-192.png', self.registration.scope).toString(),
    badge: new URL('icon-192.png', self.registration.scope).toString(),
    tag: String(payload.tag || 'swifthaul-delivery-update'),
    data: { url: String(payload.url || './') },
    renotify: true
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './', self.registration.scope).toString();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
        await client.focus();
        if ('navigate' in client) await client.navigate(target);
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
