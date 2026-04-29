'use client';

import { useEffect, useMemo, useState } from 'react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

function isStandaloneMode() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isiOS() {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isSafari() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /safari/i.test(ua) && !/chrome|android|crios|fxios|edgios/i.test(ua);
}

export function PwaInstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [isInstalled, setIsInstalled] = useState<boolean>(() => isStandaloneMode());

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };

    const onInstalled = () => {
      setIsInstalled(true);
      setPromptEvent(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const showIosHint = useMemo(
    () => !isInstalled && !promptEvent && !dismissed && isiOS() && isSafari(),
    [dismissed, isInstalled, promptEvent]
  );

  const showInstall = !isInstalled && !dismissed && !!promptEvent;
  const showFallbackHint =
    !isInstalled && !dismissed && !promptEvent && !(isiOS() && isSafari());

  if (!showInstall && !showIosHint && !showFallbackHint) return null;

  return (
    <div className="px-4 pt-3">
      <div className="rounded-2xl border border-purple-500/20 bg-linear-to-br from-purple-500/15 to-cyan-500/10 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-white">نصب اپ</p>
            <p className="text-[11px] text-slate-300 mt-1 leading-5">
              {showInstall
                ? 'برای تجربه شبیه اپ، خرجوک را روی هوم‌اسکرین نصب کن.'
                : showIosHint
                  ? 'در آیفون: Safari > Share > Add to Home Screen'
                  : 'در اندروید/دسکتاپ: منوی مرورگر > Install app / Add to Home Screen'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="text-slate-400 hover:text-white text-xs"
          >
            بستن
          </button>
        </div>

        {showInstall && (
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                if (!promptEvent) return;
                await promptEvent.prompt();
                const choice = await promptEvent.userChoice;
                if (choice.outcome !== 'accepted') {
                  setDismissed(true);
                }
                setPromptEvent(null);
              }}
              className="px-3 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium"
            >
              نصب
            </button>
            <span className="text-[10px] text-slate-400">
              بعد از نصب، اپ بدون نوار مرورگر باز می‌شود.
            </span>
          </div>
        )}

        {showFallbackHint && (
          <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-2.5">
            <p className="text-[10px] text-slate-400 leading-5">
              اگر دکمه نصب مرورگر ظاهر نمی‌شود، یک بار صفحه را Hard Refresh کن و
              از HTTPS استفاده کن. سپس از منوی مرورگر گزینه Install app را بزن.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
