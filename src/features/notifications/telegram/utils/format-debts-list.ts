import {
  formatJalaali,
  formatJalaaliHuman,
  parseJalaali,
  todayJalaaliInTimezone,
  type JalaaliDate,
} from '@/shared/utils/jalali';
import { compareJalaaliStrings, daysBetweenJalaali } from '@/features/notifications/utils/jalali-days';
import {
  formatTelegramMoney,
  TELEGRAM_SEPARATOR,
  toPersianDigits,
} from '@/features/notifications/telegram/utils/format-helpers';

export const TEHRAN_TIMEZONE = 'Asia/Tehran';

export type DebtListItem = {
  loanTitle: string;
  dueDateString: string;
  amountToman: number;
  daysUntilDue: number;
};

export type DebtsListScope = 'today' | 'all';

function dueLabel(daysUntilDue: number): string {
  if (daysUntilDue < 0) return `${toPersianDigits(Math.abs(daysUntilDue))} روز گذشته`;
  if (daysUntilDue === 0) return 'امروز';
  if (daysUntilDue === 1) return 'فردا';
  return `${toPersianDigits(daysUntilDue)} روز دیگر`;
}

export function installmentDaysUntilDue(
  dueDateString: string,
  today: JalaaliDate = todayJalaaliInTimezone(TEHRAN_TIMEZONE)
): number | null {
  const todayStr = formatJalaali(today);
  return daysBetweenJalaali(todayStr, dueDateString);
}

export function formatDebtsListMessage(
  items: DebtListItem[],
  scope: DebtsListScope = 'all'
): string {
  const today = todayJalaaliInTimezone(TEHRAN_TIMEZONE);
  const todayLine = toPersianDigits(formatJalaaliHuman(today));
  const heading = scope === 'today' ? '⏰ قسط‌های امروز' : '📋 بدهی‌ها و اقساط';

  if (items.length === 0) {
    const emptyLine =
      scope === 'today'
        ? '✅ امروز قسطی سررسید ندارید.'
        : '✅ قسط پرداخت‌نشده‌ای ندارید.';
    return `${heading}\n${TELEGRAM_SEPARATOR}\n📅 ${todayLine}\n\n${emptyLine}\n${TELEGRAM_SEPARATOR}`;
  }

  const sorted = [...items].sort((a, b) =>
    compareJalaaliStrings(a.dueDateString, b.dueDateString)
  );

  const lines: string[] = [heading, TELEGRAM_SEPARATOR, `📅 ${todayLine}`, ''];

  if (scope === 'today') {
    const total = sorted.reduce((sum, item) => sum + item.amountToman, 0);
    lines.push(`🟠 ${toPersianDigits(sorted.length)} قسط · ${formatTelegramMoney(total, 'TOMAN')}`);
    lines.push('');
  }

  for (const item of sorted) {
    const due = parseJalaali(item.dueDateString);
    const dueHuman = due
      ? toPersianDigits(formatJalaaliHuman(due))
      : toPersianDigits(item.dueDateString);
    const icon = item.daysUntilDue < 0 ? '🔴' : item.daysUntilDue === 0 ? '🟠' : '📌';
    lines.push(`${icon} ${item.loanTitle}`);
    lines.push(`   📅 ${dueHuman} · ${dueLabel(item.daysUntilDue)}`);
    lines.push(`   💰 ${formatTelegramMoney(item.amountToman, 'TOMAN')}`);
    lines.push('');
  }

  lines.push(TELEGRAM_SEPARATOR);
  return lines.join('\n').trim();
}
