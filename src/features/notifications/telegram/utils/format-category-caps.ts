import {
  formatTelegramMoney,
  TELEGRAM_SEPARATOR,
  toPersianDigits,
} from '@/features/notifications/telegram/utils/format-helpers';
import type { CapStatus } from '@/features/categories/utils/category-spending-caps';

function capIcon(level: CapStatus['level']): string {
  if (level === 'over') return '🔴';
  if (level === 'warn') return '🟠';
  return '🟢';
}

export function formatCategoryCapsMessage(rows: CapStatus[]): string {
  const heading = '🎯 سقف هزینه دسته‌ها (این ماه)';
  if (rows.length === 0) {
    return `${heading}\n${TELEGRAM_SEPARATOR}\nهنوز سقفی برای دسته‌های هزینه تنظیم نشده.\n${TELEGRAM_SEPARATOR}`;
  }

  const lines = [heading, TELEGRAM_SEPARATOR, ''];
  for (const row of rows.slice(0, 12)) {
    const pct = Math.min(Math.round(row.percent), 999);
    lines.push(`${capIcon(row.level)} ${row.categoryName}`);
    lines.push(
      `   ${toPersianDigits(pct)}٪ · ${formatTelegramMoney(row.spentToman, 'TOMAN')} / ${formatTelegramMoney(row.limitToman, 'TOMAN')}`
    );
    lines.push('');
  }
  lines.push(TELEGRAM_SEPARATOR);
  return lines.join('\n').trim();
}

export function formatCapThresholdAlertMessage(input: {
  categoryName: string;
  threshold: 80 | 100;
  spentToman: number;
  limitToman: number;
}): string {
  const icon = input.threshold >= 100 ? '🔴' : '🟠';
  const label = input.threshold >= 100 ? 'سقف تمام شد' : 'نزدیک سقف';
  const pct = Math.min(Math.round((input.spentToman / input.limitToman) * 100), 999);
  return [
    `${icon} ${label}`,
    TELEGRAM_SEPARATOR,
    `🏷 ${input.categoryName}`,
    `💰 ${formatTelegramMoney(input.spentToman, 'TOMAN')} از ${formatTelegramMoney(input.limitToman, 'TOMAN')}`,
    `📊 ${toPersianDigits(pct)}٪ مصرف شده`,
    TELEGRAM_SEPARATOR,
  ].join('\n');
}

export function formatExpenseCapLine(input: {
  categoryName: string;
  spentToman: number;
  limitToman: number;
  percent: number;
}): string {
  const pct = Math.min(Math.round(input.percent), 999);
  const icon = input.percent >= 100 ? '🔴' : '🟠';
  return `${icon} سقف «${input.categoryName}»: ${toPersianDigits(pct)}٪ (${formatTelegramMoney(input.spentToman, 'TOMAN')} / ${formatTelegramMoney(input.limitToman, 'TOMAN')})`;
}
