'use client';

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Link2, Unlink } from 'lucide-react';
import { useToast } from '@/shared/components/Toast';
import type { TelegramConnection } from '@/shared/types/domain';

export function TelegramConnectionSection() {
  const toast = useToast();
  const [connection, setConnection] = useState<TelegramConnection | null>(null);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);

  const loadConnection = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/telegram/connection');
      if (!res.ok) throw new Error('load failed');
      const json = (await res.json()) as { connection: TelegramConnection | null };
      setConnection(json.connection);
    } catch {
      toast.error('خطا در دریافت وضعیت تلگرام.');
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadConnection();
  }, [loadConnection]);

  const handleConnect = async () => {
    setIsBusy(true);
    try {
      const res = await fetch('/api/telegram/link', { method: 'POST' });
      const json = (await res.json()) as { linkUrl?: string; error?: string };
      if (!res.ok || !json.linkUrl) {
        throw new Error(json.error ?? 'link failed');
      }
      setLinkUrl(json.linkUrl);
      window.open(json.linkUrl, '_blank', 'noopener,noreferrer');
      toast.success('لینک اتصال ساخته شد. در تلگرام «Start» را بزنید.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'خطا در ساخت لینک.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setIsBusy(true);
    try {
      const res = await fetch('/api/telegram/connection', { method: 'POST' });
      if (!res.ok) throw new Error('disconnect failed');
      setConnection(null);
      setLinkUrl(null);
      toast.success('اتصال تلگرام قطع شد.');
    } catch {
      toast.error('خطا در قطع اتصال.');
    } finally {
      setIsBusy(false);
    }
  };

  const connected = connection?.is_active !== false && !!connection;

  return (
    <section className="bg-[#1A1B26] border border-white/5 rounded-3xl p-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-sky-500/10 flex items-center justify-center text-sky-400">
          <Link2 size={20} />
        </div>
        <div>
          <h3 className="font-bold text-white">تلگرام</h3>
          <p className="text-xs text-slate-400 mt-0.5">دریافت گزارش و یادآور اقساط</p>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-500 animate-pulse">در حال بارگذاری...</p>
      ) : connected ? (
        <div className="space-y-3">
          <div className="text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl px-4 py-3">
            ✅ متصل
            {connection.telegram_username ? (
              <span className="text-slate-300 mr-2" dir="ltr">
                @{connection.telegram_username}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            disabled={isBusy}
            onClick={() => void handleDisconnect()}
            className="w-full flex items-center justify-center gap-2 bg-rose-500/10 hover:bg-rose-500/15 border border-rose-500/20 text-rose-400 py-3 rounded-2xl text-sm font-medium transition-colors disabled:opacity-50"
          >
            <Unlink size={16} />
            قطع اتصال
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-400 leading-relaxed">
            برای دریافت پیام‌های خصوصی، ربات را در تلگرام فعال کنید.
          </p>
          <button
            type="button"
            disabled={isBusy}
            onClick={() => void handleConnect()}
            className="w-full flex items-center justify-center gap-2 bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 text-sky-300 py-3 rounded-2xl text-sm font-medium transition-colors disabled:opacity-50"
          >
            <ExternalLink size={16} />
            اتصال تلگرام
          </button>
          {linkUrl ? (
            <p className="text-xs text-slate-500 break-all" dir="ltr">
              {linkUrl}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
