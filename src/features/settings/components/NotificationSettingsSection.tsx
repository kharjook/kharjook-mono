'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { useToast } from '@/shared/components/Toast';
import type { NotificationReportInterval, NotificationSettings } from '@/shared/types/domain';
import { JALALI_WEEKDAY_NAMES } from '@/features/notifications/telegram/utils/format-helpers';

const INTERVAL_OPTIONS: { id: NotificationReportInterval; label: string }[] = [
  { id: 'daily', label: 'روزانه' },
  { id: 'weekly', label: 'هفتگی' },
];

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 py-2 cursor-pointer">
      <span className="text-sm text-slate-300">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition-colors ${
          checked ? 'bg-purple-500' : 'bg-white/10'
        }`}
      >
        <span
          className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
            checked ? 'right-0.5' : 'right-[1.375rem]'
          }`}
        />
      </button>
    </label>
  );
}

export function NotificationSettingsSection() {
  const toast = useToast();
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/notifications/settings');
      if (!res.ok) throw new Error('load failed');
      const json = (await res.json()) as { settings: NotificationSettings };
      setSettings(json.settings);
    } catch {
      toast.error('خطا در دریافت تنظیمات اعلان.');
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const saveSettings = async (next: NotificationSettings) => {
    setSettings(next);
    setIsSaving(true);
    try {
      const res = await fetch('/api/notifications/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error('save failed');
      const json = (await res.json()) as { settings: NotificationSettings };
      setSettings(json.settings);
      toast.success('تنظیمات ذخیره شد.');
    } catch {
      toast.error('خطا در ذخیره تنظیمات.');
      void loadSettings();
    } finally {
      setIsSaving(false);
    }
  };

  const patch = (partial: Partial<NotificationSettings>) => {
    if (!settings) return;
    void saveSettings({ ...settings, ...partial });
  };

  if (isLoading || !settings) {
    return (
      <section className="bg-[#1A1B26] border border-white/5 rounded-3xl p-5">
        <p className="text-sm text-slate-500 animate-pulse">در حال بارگذاری تنظیمات...</p>
      </section>
    );
  }

  const reportTime = settings.report_time.slice(0, 5);

  return (
    <section className="bg-[#1A1B26] border border-white/5 rounded-3xl p-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-400">
          {settings.enabled ? <Bell size={20} /> : <BellOff size={20} />}
        </div>
        <div>
          <h3 className="font-bold text-white">اعلان‌ها</h3>
          <p className="text-xs text-slate-400 mt-0.5">زمان گزارش و محتوای پیام</p>
        </div>
      </div>

      <ToggleRow
        label="فعال‌سازی همه اعلان‌ها"
        checked={settings.enabled}
        onChange={(enabled) => patch({ enabled })}
      />
      <ToggleRow
        label="گزارش دوره‌ای"
        checked={settings.report_enabled}
        onChange={(report_enabled) => patch({ report_enabled })}
      />

      <div className={`space-y-3 ${!settings.enabled ? 'opacity-50 pointer-events-none' : ''}`}>
        <div>
          <label className="text-xs text-slate-400 block mb-2">بازه گزارش</label>
          <div className="grid grid-cols-2 gap-2">
            {INTERVAL_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                disabled={isSaving}
                onClick={() => patch({ report_interval: opt.id })}
                className={`py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                  settings.report_interval === opt.id
                    ? 'bg-purple-500/20 border-purple-500/40 text-purple-200'
                    : 'bg-white/5 border-white/5 text-slate-400 hover:bg-white/10'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {settings.report_interval === 'weekly' ? (
          <div>
            <label className="text-xs text-slate-400 block mb-2">روز ارسال (هفته شمسی)</label>
            <select
              value={settings.report_day_of_week}
              disabled={isSaving}
              onChange={(e) => patch({ report_day_of_week: Number(e.target.value) })}
              className="w-full bg-[#0F1015] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white"
            >
              {JALALI_WEEKDAY_NAMES.map((name, idx) => (
                <option key={name} value={idx}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div>
          <label className="text-xs text-slate-400 block mb-2">ساعت ارسال</label>
          <input
            type="time"
            value={reportTime}
            disabled={isSaving}
            onChange={(e) => patch({ report_time: `${e.target.value}:00` })}
            className="w-full bg-[#0F1015] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white"
          />
        </div>

        <div>
          <label className="text-xs text-slate-400 block mb-2">منطقه زمانی</label>
          <input
            type="text"
            value={settings.timezone}
            disabled={isSaving}
            onChange={(e) => patch({ timezone: e.target.value })}
            className="w-full bg-[#0F1015] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white"
            dir="ltr"
          />
        </div>

        <div className="pt-2 border-t border-white/5 space-y-1">
          <p className="text-xs text-slate-500 mb-2">محتوای گزارش</p>
          <ToggleRow
            label="گردش نقدی (تومان)"
            checked={settings.show_cashflow_irt}
            onChange={(show_cashflow_irt) => patch({ show_cashflow_irt })}
          />
          <ToggleRow
            label="گردش نقدی (دلار)"
            checked={settings.show_cashflow_usd}
            onChange={(show_cashflow_usd) => patch({ show_cashflow_usd })}
          />
          <ToggleRow
            label="ارزش پرتفolio (تومان)"
            checked={settings.show_portfolio_irt}
            onChange={(show_portfolio_irt) => patch({ show_portfolio_irt })}
          />
          <ToggleRow
            label="ارزش پرتفolio (دلار)"
            checked={settings.show_portfolio_usd}
            onChange={(show_portfolio_usd) => patch({ show_portfolio_usd })}
          />
        </div>
      </div>
    </section>
  );
}
