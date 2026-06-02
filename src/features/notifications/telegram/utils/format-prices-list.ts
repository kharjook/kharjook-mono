import type { Asset } from '@/shared/types/domain';
import {
  formatJalaaliHuman,
  jalaaliWeekday,
  todayJalaaliInTimezone,
} from '@/shared/utils/jalali';
import { TEHRAN_TIMEZONE } from '@/features/notifications/telegram/utils/format-debts-list';
import {
  formatTelegramMoney,
  JALALI_WEEKDAY_NAMES,
  TELEGRAM_SEPARATOR,
  toPersianDigits,
} from '@/features/notifications/telegram/utils/format-helpers';

export function formatPricesListMessage(assets: Asset[], usdRate: number): string {
  const today = todayJalaaliInTimezone(TEHRAN_TIMEZONE);
  const weekday = JALALI_WEEKDAY_NAMES[jalaaliWeekday(today)] ?? '';
  const dateLine = `${toPersianDigits(formatJalaaliHuman(today))} · ${weekday}`;

  const priced = assets
    .filter((a) => a.include_in_balance !== false)
    .sort((a, b) => a.name.localeCompare(b.name, 'fa'));

  if (priced.length === 0) {
    return [
      '📈 قیمت دارایی‌ها',
      TELEGRAM_SEPARATOR,
      `📅 ${dateLine}`,
      '',
      'دارایی با موجودی فعال برای نمایش قیمت ندارید.',
      TELEGRAM_SEPARATOR,
    ].join('\n');
  }

  const lines: string[] = [
    '📈 قیمت دارایی‌ها',
    TELEGRAM_SEPARATOR,
    `📅 ${dateLine}`,
    '',
  ];

  if (usdRate > 0) {
    lines.push(`💵 نرخ دلار: ${formatTelegramMoney(usdRate, 'TOMAN')}`, '');
  }

  for (const asset of priced) {
    const auto = asset.price_source_id ? '🔄' : '✋';
    lines.push(`${auto} ${asset.name}`);
    lines.push(
      `   ${formatTelegramMoney(asset.price_toman, 'TOMAN')} / ${asset.unit}` +
        (asset.price_usd > 0 ? ` · ${formatTelegramMoney(asset.price_usd, 'USD')}` : '')
    );
  }

  lines.push('', '🔄 = خودکار · ✋ = دستی', TELEGRAM_SEPARATOR);
  return lines.join('\n');
}

export function formatPriceRefreshResultMessage(input: {
  updatedCount: number;
  usdRate: number;
  failedProviders: string[];
}): string {
  const lines = [
    '✅ بروزرسانی قیمت‌ها',
    TELEGRAM_SEPARATOR,
    `📦 ${toPersianDigits(input.updatedCount)} دارایی بروز شد.`,
  ];
  if (input.usdRate > 0) {
    lines.push(`💵 نرخ دلار: ${formatTelegramMoney(input.usdRate, 'TOMAN')}`);
  }
  if (input.failedProviders.length > 0) {
    lines.push('', `⚠️ خطا: ${input.failedProviders.join(' · ')}`);
  }
  lines.push(TELEGRAM_SEPARATOR);
  return lines.join('\n');
}
