/* GST Bill SW — gst-bill-v6: network-first shell, cache-first static assets */
const CACHE = 'gst-bill-v6';
const APP_VERSION = 'v6';

// Precache shell + static so offline still works after first online visit
const PRECACHE = [
  './',
  './index.html',
  './styles.css?v=6',
  './styles.css',
  './app.js?v=6',
  './app.js',
  './manifest.json',
  './vendor/jspdf.umd.min.js',
  './vendor/jspdf.plugin.autotable.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

function isShellRequest(url) {
  const p = url.pathname;
  const name = p.split('/').pop() || '';
  // HTML navigations and app shell files (with or without ?v=)
  if (url.searchParams.has('v') && (name.startsWith('app.js') || name.startsWith('styles.css'))) return true;
  if (name === 'app.js' || name === 'styles.css' || name === 'index.html' || name === 'sw.js' || name === 'manifest.json' || name === '') return true;
  if (p.endsWith('/') || name.endsWith('.html')) return true;
  return false;
}

function isStaticAsset(url) {
  const p = url.pathname;
  return p.includes('/vendor/') || p.includes('/icons/');
}

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never try to "fetch" the SW file through this handler in a way that loops;
  // browsers fetch sw.js bypassing HTTP cache on update checks anyway.
  if (url.pathname.endsWith('/sw.js')) {
    e.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  if (isStaticAsset(url)) {
    // cache-first for vendor + icons
    e.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        });
      }).catch(() => caches.match(req))
    );
    return;
  }

  if (isShellRequest(url) || req.mode === 'navigate') {
    // network-first for HTML/JS/CSS/manifest
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => {
            c.put(req, copy);
            // also store unversioned key for offline friends
            try {
              const u = new URL(req.url);
              if (u.search) {
                const bare = u.pathname.replace(/.*\//, './');
                c.put(bare, copy.clone());
              }
            } catch (_) {}
          });
        }
        return res;
      }).catch(() =>
        caches.match(req).then((c) => c || caches.match('./index.html') || caches.match('./'))
      )
    );
    return;
  }

  // default: network, fall back cache
  e.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req))
  );
});
