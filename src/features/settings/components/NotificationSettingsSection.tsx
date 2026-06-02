'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, CalendarClock, MessageCircle } from 'lucide-react';
import { useToast } from '@/shared/components/Toast';

type DebtReminderSettings = {
  enabled: boolean;
};

export function NotificationSettingsSection() {
  const toast = useToast();
  const [settings, setSettings] = useState<DebtReminderSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/notifications/settings');
      if (!res.ok) throw new Error('load failed');
      const json = (await res.json()) as { settings: DebtReminderSettings };
      setSettings(json.settings);
    } catch {
      toast.error('خطا در دریافت تنظیمات.');
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const setEnabled = async (enabled: boolean) => {
    setSettings({ enabled });
    setIsSaving(true);
    try {
      const res = await fetch('/api/notifications/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error('save failed');
      toast.success(enabled ? 'یادآور قسط امروز فعال شد.' : 'یادآور خاموش شد.');
    } catch {
      toast.error('خطا در ذخیره.');
      void loadSettings();
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading || !settings) {
    return (
      <section className="bg-[#1A1B26] border border-white/5 rounded-3xl p-5">
        <p className="text-sm text-slate-500 animate-pulse">در حال بارگذاری...</p>
      </section>
    );
  }

  return (
    <section className="overflow-hidden bg-[#1A1B26] border border-white/5 rounded-3xl">
      <div className="bg-linear-to-l from-amber-500/15 via-orange-500/5 to-transparent px-5 pt-5 pb-4 border-b border-white/5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={`w-11 h-11 rounded-2xl flex items-center justify-center border ${
                settings.enabled
                  ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                  : 'bg-white/5 border-white/10 text-slate-500'
              }`}
            >
              {settings.enabled ? <Bell size={20} /> : <BellOff size={20} />}
            </div>
            <div>
              <h3 className="font-bold text-white">یادآور بدهی</h3>
              <p className="text-xs text-slate-400 mt-1">فقط قسط‌های سررسید امروز</p>
            </div>
          </div>
          <span
            className={`shrink-0 text-[11px] font-medium px-2.5 py-1 rounded-full border ${
              settings.enabled
                ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
                : 'bg-white/5 border-white/10 text-slate-500'
            }`}
          >
            {settings.enabled ? 'فعال' : 'خاموش'}
          </span>
        </div>
      </div>

      <div className="p-5 space-y-4">
        <div className="flex gap-3 rounded-2xl bg-[#0F1015] border border-white/5 p-4">
          <CalendarClock size={18} className="text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1.5 text-xs text-slate-400 leading-relaxed">
            <p>
              <span className="text-slate-200">هر روز ساعت ۹ صبح</span> (وقت تهران)، اگر
              قسطی برای <span className="text-slate-200">امروز شمسی</span> داشته باشید، در
              تلگرام پیام می‌گیرید.
            </p>
            <p>روزهای بدون قسط امروز → پیامی ارسال نمی‌شود.</p>
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={settings.enabled}
          disabled={isSaving}
          onClick={() => void setEnabled(!settings.enabled)}
          className={`w-full flex items-center justify-between gap-4 rounded-2xl border p-4 text-right transition-colors disabled:opacity-50 ${
            settings.enabled
              ? 'bg-amber-500/10 border-amber-500/25 hover:bg-amber-500/15'
              : 'bg-[#0F1015] border-white/5 hover:border-white/10'
          }`}
        >
          <div>
            <p className="text-sm font-medium text-white">یادآوری خودکار در تلگرام</p>
            <p className="text-xs text-slate-500 mt-1">
              {settings.enabled ? 'قسط‌های امروز — ۹:۰۰ صبح' : 'غیرفعال'}
            </p>
          </div>
          <div
            className={`relative w-12 h-7 rounded-full shrink-0 transition-colors ${
              settings.enabled ? 'bg-amber-500' : 'bg-white/10'
            }`}
          >
            <span
              className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                settings.enabled ? 'right-1' : 'right-6'
              }`}
            />
          </div>
        </button>

        <div className="rounded-2xl bg-[#0F1015] border border-white/5 p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <MessageCircle size={14} className="text-sky-400" />
            <span>در تلگرام دکمه «درآمد و هزینه امروز» را بزنید</span>
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            گزارش درآمد و هزینه روز جاری (شمسی) از بات دریافت می‌شود — بدون نیاز به دستور.
          </p>
        </div>
      </div>
    </section>
  );
}
