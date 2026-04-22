'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    let cancelled = false;

    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
          updateViaCache: 'none',
        });

        if (cancelled) return;

        if (reg.waiting) {
          reg.waiting.postMessage('SKIP_WAITING');
        }

        reg.addEventListener('updatefound', () => {
          const next = reg.installing;
          if (!next) return;
          next.addEventListener('statechange', () => {
            if (next.state === 'installed') {
              next.postMessage('SKIP_WAITING');
            }
          });
        });

        reg.update().catch(() => {});
      } catch {
        // Silently ignore — registration failures should never break the app.
      }
    };

    register();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
