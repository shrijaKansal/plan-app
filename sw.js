/* Offline support. Serves files from the cache first, then refreshes them in
   the background, so the app opens instantly with no signal and picks up
   edits the next time you open it. Your logs live in the phone, not here. */
var CACHE = 'plan-shell-v4';
var FILES = [
  './', 'index.html', 'styles.css', 'plan.js', 'lib.js', 'charts.js', 'app.js',
  'manifest.webmanifest', 'plan-loader.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(req, { ignoreSearch: true }).then(function (hit) {
        var refresh = fetch(req).then(function (res) {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        }).catch(function () { return hit || (req.mode === 'navigate' ? cache.match('index.html') : undefined); });
        return hit || refresh;
      });
    })
  );
});

self.addEventListener('message', function (e) {
  if (e.data === 'purge') {
    e.waitUntil(caches.delete(CACHE));
  }
});
