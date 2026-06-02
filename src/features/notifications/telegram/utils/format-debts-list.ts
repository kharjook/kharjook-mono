import type { Loan, LoanInstallment } from '@/shared/types/domain';
import {
  formatJalaaliHuman,
  parseJalaali,
  todayJalaali,
  formatJalaali,
} from '@/shared/utils/jalali';
import { compareJalaaliStrings, daysBetweenJalaali } from '@/features/notifications/utils/jalali-days';
import {
  formatTelegramMoney,
  TELEGRAM_SEPARATOR,
  toPersianDigits,
} from '@/features/notifications/telegram/utils/format-helpers';

export type DebtListItem = {
  loanTitle: string;
  dueDateString: string;
  amountToman: number;
  daysUntilDue: number;
};

function dueLabel(daysUntilDue: number): string {
  if (daysUntilDue < 0) return `${toPersianDigits(Math.abs(daysUntilDue))} روز گذشته`;
  if (daysUntilDue === 0) return 'امروز';
  if (daysUntilDue === 1) return 'فردا';
  return `${toPersianDigits(daysUntilDue)} روز دیگر`;
}

export function formatDebtsListMessage(items: DebtListItem[]): string {
  const today = todayJalaali();
  const todayLine = toPersianDigits(formatJalaaliHuman(today));

  if (items.length === 0) {
    return `📋 بدهی‌ها و اقساط\n${TELEGRAM_SEPARATOR}\n📅 ${todayLine}\n\n✅ قسط پرداخت‌نشده‌ای ندارید.\n${TELEGRAM_SEPARATOR}`;
  }

  const sorted = [...items].sort((a, b) =>
    compareJalaaliStrings(a.dueDateString, b.dueDateString)
  );

  const lines: string[] = [
    '📋 بدهی‌ها و اقساط',
    TELEGRAM_SEPARATOR,
    `📅 ${todayLine}`,
    '',
  ];

  for (const item of sorted) {
    const due = parseJalaali(item.dueDateString);
    const dueHuman = due
      ? toPersianDigits(formatJalaaliHuman(due))
      : toPersianDigits(item.dueDateString);
    const icon = item.daysUntilDue < 0 ? '🔴' : item.daysUntilDue === 0 ? '🟠' : '📌';
    lines.push(icon + ` ${item.loanTitle}`);
    lines.push(`   📅 ${dueHuman} · ${dueLabel(item.daysUntilDue)}`);
    lines.push(`   💰 ${formatTelegramMoney(item.amountToman, 'TOMAN')}`);
    lines.push('');
  }

  lines.push(TELEGRAM_SEPARATOR);
  return lines.join('\n').trim();
}

export function installmentDaysUntilDue(dueDateString: string): number | null {
  const todayStr = formatJalaali(todayJalaali());
  return daysBetweenJalaali(todayStr, dueDateString);
}
