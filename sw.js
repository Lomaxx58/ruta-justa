// Guarda la app para que abra al instante y funcione la calculadora sin conexión.
const CACHE = "ruta-justa-v2";
const APP = ["./", "index.html", "app.js", "coches.json", "manifest.webmanifest", "icon-192.png", "icon-512.png",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(APP))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  const esApp = url.origin === location.origin || url.hostname === "cdnjs.cloudflare.com";
  if (!esApp || e.request.method !== "GET") return; // mapas, rutas y búsquedas siempre por red
  // Red primero (para recibir actualizaciones), caché si no hay conexión
  e.respondWith(fetch(e.request).then(r => {
    const copia = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copia)); return r;
  }).catch(() => caches.match(e.request)));
});
