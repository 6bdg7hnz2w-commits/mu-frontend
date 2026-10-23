self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
// Vesper 的背景图：先拿缓存里的立刻出图，后台再去服务器对一次（服务器给的是 max-age=0，不缓存的话每次打开都要等一个来回）
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith('/vesper/')) return
  e.respondWith(caches.open('mu-vesper-img').then(async (cache) => {
    const hit = await cache.match(e.request)
    const fresh = fetch(e.request).then((r) => { if (r.ok) cache.put(e.request, r.clone()); return r })
    if (hit) { e.waitUntil(fresh.catch(() => {})); return hit }
    return fresh
  }))
})
