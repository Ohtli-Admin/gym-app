const CACHE = 'gymapp-v1';
const ARCHIVOS = ['./', './index.html', './styles.css', './app.js', './supabaseClient.js', './manifest.json'];

self.addEventListener('install', (evt) => {
  evt.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ARCHIVOS)));
  self.skipWaiting();
});

self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

// Network-first: siempre intenta traer lo más nuevo; si no hay internet,
// usa lo que tenga guardado en caché.
self.addEventListener('fetch', (evt) => {
  if (evt.request.method !== 'GET') return;
  evt.respondWith(
    fetch(evt.request)
      .then((resp) => {
        const copia = resp.clone();
        caches.open(CACHE).then((cache) => cache.put(evt.request, copia));
        return resp;
      })
      .catch(() => caches.match(evt.request)),
  );
});
