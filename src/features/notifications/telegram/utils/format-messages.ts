import type {
  CashflowSummary,
  UserNotificationSnapshot,
} from '@/features/notifications/utils/build-user-snapshot';
import {
  formatJalaaliHuman,
  jalaaliWeekday,
  todayJalaali,
} from '@/shared/utils/jalali';
import {
  formatTelegramMoney,
  JALALI_WEEKDAY_NAMES,
  TELEGRAM_SEPARATOR,
  toPersianDigits,
} from '@/features/notifications/telegram/utils/format-helpers';

function formatCashflowBlock(
  label: string,
  toman: CashflowSummary,
  usd: CashflowSummary
): string[] {
  return [
    `📆 ${label}`,
    `💚 درآمد: ${formatTelegramMoney(toman.income, 'TOMAN')}`,
    `🔴 هزینه: ${formatTelegramMoney(toman.expense, 'TOMAN')}`,
    `📈 خالص: ${formatTelegramMoney(toman.net, 'TOMAN')}`,
    `💚 درآمد: ${formatTelegramMoney(usd.income, 'USD')}`,
    `🔴 هزینه: ${formatTelegramMoney(usd.expense, 'USD')}`,
    `📈 خالص: ${formatTelegramMoney(usd.net, 'USD')}`,
  ];
}

/** On-demand bot report — always includes all sections. */
export function formatDailyReportMessage(
  snapshot: UserNotificationSnapshot & {
    todayUsd: CashflowSummary;
    monthUsd: CashflowSummary;
  }
): string {
  const today = todayJalaali();
  const weekday = JALALI_WEEKDAY_NAMES[jalaaliWeekday(today)] ?? '';
  const dateLine = `${toPersianDigits(formatJalaaliHuman(today))} · ${weekday}`;

  const lines: string[] = [
    '📊 گزارش خرجوک',
    TELEGRAM_SEPARATOR,
    `📅 ${dateLine}`,
    '',
    ...formatCashflowBlock('امروز', snapshot.today, snapshot.todayUsd),
    '',
    ...formatCashflowBlock('ماه جاری (تا امروز)', snapshot.month, snapshot.monthUsd),
    '',
    '💼 ارزش کل پرتفolio',
    `🇮🇷 ${formatTelegramMoney(snapshot.portfolio.totalToman, 'TOMAN')}`,
    `💵 نقد: ${formatTelegramMoney(snapshot.portfolio.cashToman, 'TOMAN')} · 📦 دارایی: ${formatTelegramMoney(snapshot.portfolio.assetsToman, 'TOMAN')}`,
    `🇺🇸 ${formatTelegramMoney(snapshot.portfolio.totalUsd, 'USD')}`,
    '',
  ];

  const unpriced =
    snapshot.today.unpricedCount +
    snapshot.month.unpricedCount +
    snapshot.todayUsd.unpricedCount +
    snapshot.monthUsd.unpricedCount;
  if (unpriced > 0) {
    lines.push(
      `⚠️ ${toPersianDigits(unpriced)} تراکنش بدون نرخ ثبت‌شده — در گزارش لحاظ نشده.`
    );
    lines.push('');
  }

  lines.push(TELEGRAM_SEPARATOR);
  return lines.join('\n').trim();
}
