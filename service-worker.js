const CACHE = 'molife-v4-28';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=4.28',
  './pawnshop.css?v=4.28',
  './mood.css?v=4.28',
  './metrics.css?v=4.28',
  './settings.css?v=4.28',
  './info.css?v=4.28',
  './app.js?v=4.28',
  './metrics-viewer.js?v=4.28',
  './cloud.js?v=4.28',
  './manifest.webmanifest',
  './icon.svg',
  './fonts/PunkKid.ttf'
];

// Only versioned application assets belong in CacheStorage; arbitrary same-origin
// GETs (including cache-busted URLs) must not grow the cache without a limit.
const APP_PATH = new URL('./', self.registration.scope).pathname;
const INDEX_PATH = new URL('./index.html', self.registration.scope).pathname;
const STATIC_ASSET_URLS = new Set(
  ASSETS.filter(asset => asset !== './' && asset !== './index.html')
    .map(asset => new URL(asset, self.registration.scope).href)
);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key.startsWith('molife-') && key !== CACHE).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Authentication and user state must never enter the service-worker cache.
  if (url.pathname.includes('/api/')) {
    return;
  }

  if (request.mode === 'navigate') {
    // Do not overwrite our offline app shell with another route's HTML.
    if (url.pathname !== APP_PATH && url.pathname !== INDEX_PATH) return;
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put('./index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  if (!STATIC_ASSET_URLS.has(url.href)) return;

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request).then(response => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
