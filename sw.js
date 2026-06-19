const CACHE_NAME = 'glow-v38';
const ASSETS = ['/', '/index.html', '/style.css', '/glow.js', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('api.open-meteo.com') || e.request.url.includes('restapi.amap.com') || e.request.url.includes('webapi.amap.com')) {
    // API 请求：网络优先，不缓存
    e.respondWith(fetch(e.request).catch(() => new Response('{"error":"offline"}', { status: 503 })));
  } else {
    // 静态资源：缓存优先，后台更新
    e.respondWith(caches.match(e.request).then(r => {
      const fetchPromise = fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => r);
      return r || fetchPromise;
    }));
  }
});
