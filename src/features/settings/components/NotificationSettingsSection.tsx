'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { useToast } from '@/shared/components/Toast';

type DebtReminderSettings = {
  enabled: boolean;
};

function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center justify-between gap-3 py-2 cursor-pointer">
      <span className="text-sm text-slate-300">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition-colors disabled:opacity-50 ${
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
      toast.success('ذخیره شد.');
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
    <section className="bg-[#1A1B26] border border-white/5 rounded-3xl p-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-400">
          {settings.enabled ? <Bell size={20} /> : <BellOff size={20} />}
        </div>
        <div>
          <h3 className="font-bold text-white">یادآور بدهی</h3>
          <p className="text-xs text-slate-400 mt-0.5">لیست اقساط — هر روز ۹ صبح</p>
        </div>
      </div>

      <p className="text-xs text-slate-400 leading-relaxed">
        گزارش مالی و پرتفolio فقط در تلگرام:{' '}
        <span className="text-sky-300 font-mono" dir="ltr">
          /report
        </span>{' '}
        و{' '}
        <span className="text-sky-300 font-mono" dir="ltr">
          /debts
        </span>
      </p>

      <ToggleRow
        label="ارسال خودکار لیست بدهی‌ها"
        checked={settings.enabled}
        disabled={isSaving}
        onChange={(enabled) => void setEnabled(enabled)}
      />
    </section>
  );
}
