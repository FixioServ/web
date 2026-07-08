// ==========================================================================
// SERVICE WORKER DE FIXIO
// Estrategia: red primero (siempre la versión más reciente), con caché de
// respaldo solo para recursos estáticos cuando no hay conexión.
// Las llamadas a /api y al socket NUNCA se tocan.
// ==========================================================================
const CACHE = 'fixio-v1';
const ESTATICOS = [
    '/manifest.json',
    '/logo_fixio.png',
    '/icon-192.png',
    '/icon-512.png',
    '/favicon.png'
];

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(ESTATICOS)).catch(() => {}));
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(claves =>
            Promise.all(claves.filter(k => k !== CACHE).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);

    // Nunca interceptar la API, el socket ni peticiones que no sean GET
    if (e.request.method !== 'GET') return;
    if (url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io')) return;

    // Red primero; si falla (sin conexión), servir del caché
    e.respondWith(
        fetch(e.request)
            .then(res => {
                // Guardar copia de los estáticos exitosos para uso sin conexión
                if (res.ok && (ESTATICOS.includes(url.pathname) || url.pathname.endsWith('.html'))) {
                    const copia = res.clone();
                    caches.open(CACHE).then(c => c.put(e.request, copia)).catch(() => {});
                }
                return res;
            })
            .catch(() => caches.match(e.request))
    );
});
