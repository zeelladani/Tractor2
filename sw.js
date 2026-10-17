// sw.js
const CACHE = "zm-tractor-v8";
const SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./firebase.js",
  "./manifest.json",
  "./ZM_tractor.png"
];
const BYPASS = [
  "firebase",
  "google",
  "gstatic",
  "placehold",
  "firestore",
  "googleapis",
  "jspdf"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.all(SHELL.map(url =>
        c.add(url).catch(err => console.warn("SW precache failed:", url, err))
      ))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = req.url;
  if (BYPASS.some(host => url.includes(host))) return;

  e.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then(r => r || caches.match("./index.html")))
  );
});