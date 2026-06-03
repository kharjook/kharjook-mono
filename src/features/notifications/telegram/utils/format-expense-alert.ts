import {
  formatTelegramMoney,
  TELEGRAM_SEPARATOR,
} from '@/features/notifications/telegram/utils/format-helpers';

export function formatExpenseAlertMessage(input: {
  addedAmountToman: number;
  todayTotalExpenseToman: number;
  categoryName?: string | null;
  note?: string | null;
  capLine?: string | null;
}): string {
  const lines = [
    '🔴 هزینه ثبت شد',
    TELEGRAM_SEPARATOR,
    `💰 مبلغ: ${formatTelegramMoney(input.addedAmountToman, 'TOMAN')}`,
  ];

  if (input.categoryName?.trim()) {
    lines.push(`🏷 دسته: ${input.categoryName.trim()}`);
  }
  if (input.note?.trim()) {
    lines.push(`📝 ${input.note.trim()}`);
  }
  if (input.capLine?.trim()) {
    lines.push('');
    lines.push(input.capLine.trim());
  }

  lines.push(
    '',
    `📊 جمع هزینه امروز: ${formatTelegramMoney(input.todayTotalExpenseToman, 'TOMAN')}`,
    TELEGRAM_SEPARATOR
  );

  return lines.join('\n').trim();
}
