'use client';

import { Camera, Loader2, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { supabase } from '@/shared/lib/supabase/client';
import { compressImageToSquareWebp } from '@/shared/utils/compress-image';

const BUCKET = 'entity-icons';
const MAX_SOURCE_BYTES = 10 * 1024 * 1024; // 10 MB raw cap before compression

type Props = {
  value: string | null;
  onChange: (url: string | null) => void;
  userId: string;
  folder: 'assets' | 'wallets';
  fallback: React.ReactNode;
  bgColor?: string;
  label?: string;
  disabled?: boolean;
};

/**
 * Controlled icon uploader. Picks a file, compresses to a square 256×256 WebP,
 * uploads to the `entity-icons` Supabase Storage bucket, and hands the public
 * URL back to the parent. Never touches the owning row — the parent persists
 * `icon_url` when saving the form.
 *
 * Orphan files (re-uploads, removals before save, deleted entities) are left
 * in storage for now; a future cleanup job can sweep them using the
 * `user_id` folder prefix.
 */
export function IconPicker({
  value,
  onChange,
  userId,
  folder,
  fallback,
  bgColor,
  label,
  disabled,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handlePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Always reset so the same file can be re-selected after a failure.
    e.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('لطفاً یک فایل تصویری انتخاب کن.');
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      alert('حجم تصویر نباید بیشتر از ۱۰ مگابایت باشد.');
      return;
    }

    setIsUploading(true);
    try {
      const blob = await compressImageToSquareWebp(file);
      // Random path: decouples upload from entity id (works for create + edit)
      // and guarantees a unique URL → no CDN cache invalidation headaches.
      const path = `${userId}/${folder}/${crypto.randomUUID()}.webp`;
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, blob, {
          contentType: 'image/webp',
          cacheControl: '31536000',
          upsert: false,
        });
      if (error) throw error;
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
      onChange(data.publicUrl);
    } catch (err) {
      console.error(err);
      alert('بارگذاری آیکون ناموفق بود.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="flex items-center gap-4">
      <div
        className="relative w-16 h-16 rounded-2xl flex items-center justify-center overflow-hidden shrink-0 border border-white/10"
        style={{ backgroundColor: bgColor ?? 'rgba(148, 163, 184, 0.12)' }}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt=""
            className="w-full h-full object-cover"
            draggable={false}
          />
        ) : (
          fallback
        )}
        {isUploading && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <Loader2 className="animate-spin text-white" size={20} />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 min-w-0 flex-1">
        {label && <span className="text-xs text-slate-400">{label}</span>}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || isUploading}
            className="inline-flex items-center gap-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-slate-200 text-xs px-3 py-2 rounded-lg transition-colors"
          >
            <Camera size={14} />
            {value ? 'تغییر آیکون' : 'بارگذاری آیکون'}
          </button>
          {value && !isUploading && (
            <button
              type="button"
              onClick={() => onChange(null)}
              disabled={disabled}
              className="inline-flex items-center gap-1 text-rose-300/70 hover:text-rose-300 text-xs px-2 py-2 rounded-lg transition-colors"
              aria-label="حذف آیکون"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
        <span className="text-[11px] text-slate-500">
          اختیاری · PNG/JPG/WebP · به‌صورت مربع ۲۵۶ پیکسل فشرده می‌شود
        </span>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handlePick}
      />
    </div>
  );
}
