import type { CashflowSummary } from '@/features/notifications/utils/build-user-snapshot';
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

export function formatTodayCashflowMessage(
  todayToman: CashflowSummary,
  todayUsd: CashflowSummary
): string {
  const today = todayJalaaliInTimezone(TEHRAN_TIMEZONE);
  const weekday = JALALI_WEEKDAY_NAMES[jalaaliWeekday(today)] ?? '';
  const dateLine = `${toPersianDigits(formatJalaaliHuman(today))} · ${weekday}`;

  const lines = [
    '📊 درآمد و هزینه امروز',
    TELEGRAM_SEPARATOR,
    `📅 ${dateLine}`,
    '',
    '🇮🇷 تومان',
    `💚 درآمد: ${formatTelegramMoney(todayToman.income, 'TOMAN')}`,
    `🔴 هزینه: ${formatTelegramMoney(todayToman.expense, 'TOMAN')}`,
    `📈 خالص: ${formatTelegramMoney(todayToman.net, 'TOMAN')}`,
    '',
    '🇺🇸 دلار',
    `💚 درآمد: ${formatTelegramMoney(todayUsd.income, 'USD')}`,
    `🔴 هزینه: ${formatTelegramMoney(todayUsd.expense, 'USD')}`,
    `📈 خالص: ${formatTelegramMoney(todayUsd.net, 'USD')}`,
  ];

  const unpriced = todayToman.unpricedCount + todayUsd.unpricedCount;
  if (unpriced > 0) {
    lines.push(
      '',
      `⚠️ ${toPersianDigits(unpriced)} تراکنش بدون نرخ — در جمع لحاظ نشده.`
    );
  }

  lines.push('', TELEGRAM_SEPARATOR);
  return lines.join('\n').trim();
}
