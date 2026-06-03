import type { RecurringTransaction } from '@/shared/types/domain';

export function intervalLabel(row: Pick<RecurringTransaction, 'interval_number' | 'interval_period'>): string {
  const n = row.interval_number;
  const unit =
    row.interval_period === 'day'
      ? 'روز'
      : row.interval_period === 'week'
        ? 'هفته'
        : row.interval_period === 'month'
          ? 'ماه'
          : 'سال';
  return n === 1 ? `هر ${unit}` : `هر ${n} ${unit}`;
}
