// Сторінка: мережа першою (з 3-секундним запасом на повільний інтернет), щоб після коміту одразу була свіжа версія.
// Стилі й скрипти мають у адресі ?v=<хеш> (tools/stamp.py): їх беремо з кешу одразу, бо вміст за такою адресою не змінюється.
// Записи вимови: кеш першим, бо назва файлу містить хеш і вміст не змінюється.
const CACHE = 'ew-v11';
const AUDIO_CACHE = 'ew-audio-v2';
const CORE = ['/', '/manifest.json', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/audio/gap.mp3'];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CORE).then(() =>
      // Скрипти й стилі поточної версії сторінки, щоб наступне відкриття працювало й без мережі
      fetch('/', { cache: 'no-store' }).then(r => r.text()).then(html => {
        const urls = Array.from(html.matchAll(/(?:src|href)="(\/[^"]+\?v=[0-9a-f]+)"/g)).map(m => m[1]);
        return c.addAll(urls);
      }).catch(() => {})
    )).then(() => self.skipWaiting())
  );
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

/* Файл з ?v=: з кешу, а нову версію зберігаємо замість старих версій того самого файла */
function versioned(req) {
  return caches.open(CACHE).then(c => c.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok && res.status === 200) {
      const copy = res.clone();
      const url = new URL(req.url);
      c.put(req, copy).then(() => c.keys()).then(keys => Promise.all(keys
        .filter(k => { const u = new URL(k.url); return u.pathname === url.pathname && u.search !== url.search; })
        .map(k => c.delete(k)))).catch(() => {});
    }
    return res;
  })));
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

  if (url.searchParams.has('v')) {
    event.respondWith(versioned(req));
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
