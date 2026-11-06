const CACHE = 'swifthaul-shell-v5';
const SCOPE = self.registration.scope;
const ASSETS = ['app.css', 'icon.svg', 'icon-192.png', 'icon-512.png', 'offline.html', 'location-picker.js', 'openlocationcode.min.js']
  .map(name => new URL(name, SCOPE).pathname);
const OFFLINE = new URL('offline.html', SCOPE).pathname;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))
  ));
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Authentication, account, booking and third-party requests are never cached.
  if (url.origin !== self.location.origin || event.request.method !== 'GET' ||
      url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
    return;
  }
  if (ASSETS.includes(url.pathname)) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
  }
});
