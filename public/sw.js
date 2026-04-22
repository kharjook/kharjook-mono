// khargook service worker — intentionally does NOT cache anything.
// Purpose: satisfy PWA installability criteria (standalone display,
// add-to-home-screen prompt) without introducing any offline/stale data
// behavior. Every request goes straight to the network, handled by the
// browser as usual.

const SW_VERSION = 'khargook-nocache-v1';

self.addEventListener('install', (event) => {
  // Take over immediately; never wait for old tabs to close.
  self.skipWaiting();

  // Nuke any previously-created Cache Storage entries from older SW revisions.
  event.waitUntil(
    (async () => {
      if ('caches' in self) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Defensive: wipe any caches that might have been created between
      // install and activate.
      if ('caches' in self) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      await self.clients.claim();
    })()
  );
});

// Empty fetch handler — required by Chromium to consider the PWA installable.
// We do NOT call event.respondWith, so the browser handles every request
// normally (no SW interception, no caching).
self.addEventListener('fetch', () => {
  // intentionally empty
});

// Allow the page to trigger an immediate takeover after a SW update.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// Reference SW_VERSION so bundlers/minifiers don't strip it; also useful
// for debugging via DevTools > Application > Service Workers.
self.__SW_VERSION__ = SW_VERSION;
