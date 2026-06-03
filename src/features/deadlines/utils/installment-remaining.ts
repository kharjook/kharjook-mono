import type { LoanInstallment } from '@/shared/types/domain';

export function installmentPaidAmount(
  installment: Pick<LoanInstallment, 'paid_amount'>
): number {
  const paid = Number(installment.paid_amount);
  return Number.isFinite(paid) && paid > 0 ? paid : 0;
}

export function installmentRemainingAmount(
  installment: Pick<LoanInstallment, 'amount' | 'paid_amount'>
): number {
  const remaining = Number(installment.amount) - installmentPaidAmount(installment);
  if (!Number.isFinite(remaining) || remaining <= 0) return 0;
  return remaining;
}

export function installmentHasPartialPay(
  installment: Pick<LoanInstallment, 'amount' | 'paid_amount' | 'is_paid'>
): boolean {
  if (installment.is_paid) return false;
  return installmentPaidAmount(installment) > 0;
}

export function parsePartialPayAmount(raw: string): number | null {
  const normalized = raw.trim().replace(/,/g, '');
  if (!normalized) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

export function validatePartialPayAmount(
  payInLoanCurrency: number,
  remainingInLoanCurrency: number
): string | null {
  if (!Number.isFinite(payInLoanCurrency) || payInLoanCurrency <= 0) {
    return 'مبلغ پرداخت نامعتبر است.';
  }
  if (payInLoanCurrency > remainingInLoanCurrency + 1e-9) {
    return 'مبلغ از باقی‌مانده قسط بیشتر است.';
  }
  return null;
}

export function canonicalInstallmentAmount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  const rounded = n.toFixed(10);
  return rounded.replace(/\.?0+$/, '') || '0';
}
