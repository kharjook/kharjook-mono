import type { NotificationSettings } from '@/shared/types/domain';
import {
  formatJalaaliHuman,
  jalaaliWeekday,
  parseJalaali,
  todayJalaali,
} from '@/shared/utils/jalali';
import type {
  CashflowSummary,
  UserNotificationSnapshot,
} from '@/features/notifications/utils/build-user-snapshot';
import {
  formatTelegramMoney,
  JALALI_WEEKDAY_NAMES,
  TELEGRAM_SEPARATOR,
  toPersianDigits,
} from '@/features/notifications/telegram/utils/format-helpers';

function formatCashflowBlock(
  label: string,
  toman?: CashflowSummary,
  usd?: CashflowSummary
): string[] {
  const lines: string[] = [`📆 ${label}`];
  if (toman) {
    lines.push(`💚 درآمد: ${formatTelegramMoney(toman.income, 'TOMAN')}`);
    lines.push(`🔴 هزینه: ${formatTelegramMoney(toman.expense, 'TOMAN')}`);
    lines.push(`📈 خالص: ${formatTelegramMoney(toman.net, 'TOMAN')}`);
  }
  if (usd) {
    lines.push(`💚 درآمد: ${formatTelegramMoney(usd.income, 'USD')}`);
    lines.push(`🔴 هزینه: ${formatTelegramMoney(usd.expense, 'USD')}`);
    lines.push(`📈 خالص: ${formatTelegramMoney(usd.net, 'USD')}`);
  }
  return lines;
}

export function formatDailyReportMessage(
  settings: NotificationSettings,
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
  ];

  if (settings.show_cashflow_irt || settings.show_cashflow_usd) {
    lines.push(
      ...formatCashflowBlock(
        'امروز',
        settings.show_cashflow_irt ? snapshot.today : undefined,
        settings.show_cashflow_usd ? snapshot.todayUsd : undefined
      ),
      ''
    );
    lines.push(
      ...formatCashflowBlock(
        'ماه جاری (تا امروز)',
        settings.show_cashflow_irt ? snapshot.month : undefined,
        settings.show_cashflow_usd ? snapshot.monthUsd : undefined
      ),
      ''
    );
  }

  if (settings.show_portfolio_irt || settings.show_portfolio_usd) {
    lines.push('💼 ارزش کل پرتفolio');
    if (settings.show_portfolio_irt) {
      lines.push(`🇮🇷 ${formatTelegramMoney(snapshot.portfolio.totalToman, 'TOMAN')}`);
      lines.push(
        `💵 نقد: ${formatTelegramMoney(snapshot.portfolio.cashToman, 'TOMAN')} · 📦 دارایی: ${formatTelegramMoney(snapshot.portfolio.assetsToman, 'TOMAN')}`
      );
    }
    if (settings.show_portfolio_usd) {
      lines.push(`🇺🇸 ${formatTelegramMoney(snapshot.portfolio.totalUsd, 'USD')}`);
    }
    lines.push('');
  }

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

export function formatLoanReminderMessage(input: {
  loanTitle: string;
  dueDateString: string;
  daysUntilDue: number;
  amountToman: number;
  amountUsd: number;
  showIrt: boolean;
  showUsd: boolean;
}): string {
  const { loanTitle, dueDateString, daysUntilDue, amountToman, amountUsd } = input;
  const due = parseJalaali(dueDateString);
  const dueHuman = due ? toPersianDigits(formatJalaaliHuman(due)) : toPersianDigits(dueDateString);
  const when =
    daysUntilDue === 0
      ? 'امروز'
      : daysUntilDue === 1
        ? 'فردا'
        : `${toPersianDigits(daysUntilDue)} روز دیگر`;

  const lines = [
    '⏰ یادآور قسط',
    TELEGRAM_SEPARATOR,
    `📌 ${loanTitle}`,
    `📅 سررسید: ${dueHuman} (${when})`,
  ];

  if (input.showIrt) {
    lines.push(`💰 مبلغ: ${formatTelegramMoney(amountToman, 'TOMAN')}`);
  }
  if (input.showUsd) {
    lines.push(`💰 مبلغ: ${formatTelegramMoney(amountUsd, 'USD')}`);
  }
  lines.push(TELEGRAM_SEPARATOR);
  return lines.join('\n');
}
