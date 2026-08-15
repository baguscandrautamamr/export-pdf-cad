/* Minimal app-shell service worker. No build step, no next-pwa. */

// Bump this whenever the caching rules change: the activate handler deletes
// every cache that is not the current one, which is what evicts a bad entry
// from an older version of this file.
const CACHE = "psg-v2";

// Deliberately NOT "/" or any other page. Every page in this app is behind the
// login check, so a cached copy is a copy of whatever the session happened to
// be at cache time — precaching "/" while logged out stores the login page
// under the key "/", and it then shows up after signing in.
const SHELL = ["/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  // Page loads go straight to the network, untouched.
  //
  // Two reasons. Pages depend on the session, so serving one from cache can
  // show a signed-in user the login page. And a navigation request carries
  // redirect mode "manual": if the server answers with a redirect, handing that
  // response back through respondWith() is invalid and the navigation fails —
  // which then falls through to whatever stale page is in the cache.
  if (request.mode === "navigate") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // /api/extract and /api/generate must always hit the network — a cached
  // extraction or a cached set of generated files would be actively wrong.
  if (url.pathname.startsWith("/api/")) return;

  // React Server Component payloads. A client-side navigation to "/" fetches
  // one of these rather than a document, so caching it stores a rendering of
  // the page for one particular session — the same trap as caching "/", just
  // one layer down, and it survives a login.
  if (url.searchParams.has("_rsc") || request.headers.get("RSC") === "1") return;

  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok && res.type === "basic" && !res.redirected) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(request))
  );
});
