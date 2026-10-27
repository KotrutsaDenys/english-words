// Сторінка й дані: мережа першою, щоб після коміту одразу була свіжа версія.
// Записи вимови: кеш першим, бо назва файлу містить хеш і вміст не змінюється.
const CACHE = 'ew-v8';
const AUDIO_CACHE = 'ew-audio-v2';
const CORE = ['/', '/app.css', '/words.js', '/words-base.js', '/phrases.js', '/phrases-base.js', '/audio.js', '/js/fsrs.js', '/js/core.js', '/js/app.js', '/manifest.json', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== AUDIO_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function cacheFirst(req, cacheName) {
  return caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok && res.status === 200) {
      const copy = res.clone();
      caches.open(cacheName).then(c => c.put(req, copy)).catch(() => {});
    }
    return res;
  }));
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  // Запити частинами (так браузер іноді тягне аудіо) віддаємо браузеру напряму
  if (req.headers.has('range')) return;
  const url = new URL(req.url);

  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(req, CACHE));
    return;
  }

  if (url.origin !== self.location.origin) return;
  // Подію для Календаря віддає воркер щоразу свіжою, кешувати її не треба
  if (url.pathname.endsWith('.ics')) return;

  if (url.pathname.startsWith('/audio/')) {
    event.respondWith(cacheFirst(req, AUDIO_CACHE));
    return;
  }

  // Мережа першою, але на повільному інтернеті (на об'єкті, в дорозі) не чекаємо довше 3 с:
  // віддаємо збережену копію, а свіжа ляже в кеш на наступний раз.
  const network = fetch(req).then(res => {
    if (res.ok && res.status === 200 && !res.redirected) {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
    }
    return res;
  });
  const fallback = () => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('/') : null));
  event.respondWith(new Promise(resolve => {
    let done = false;
    const finish = r => { if (!done && r) { done = true; resolve(r); } };
    const timer = setTimeout(() => fallback().then(finish), 3000);
    network.then(res => { clearTimeout(timer); finish(res); })
      .catch(() => { clearTimeout(timer); fallback().then(hit => { if (!done) { done = true; resolve(hit || Response.error()); } }); });
  }));
  event.waitUntil(network.catch(() => {}));
});
