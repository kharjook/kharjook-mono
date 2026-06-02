import type { Wallet } from '@/shared/types/domain';

export interface WalletPaymentDetails {
  card_number: string | null;
  account_number: string | null;
  iban: string | null;
}

export function walletPaymentDetailsFromWallet(wallet: Wallet): WalletPaymentDetails {
  return {
    card_number: wallet.card_number ?? null,
    account_number: wallet.account_number ?? null,
    iban: wallet.iban ?? null,
  };
}

export function walletHasPaymentDetails(wallet: Wallet): boolean {
  return Boolean(wallet.card_number || wallet.account_number || wallet.iban);
}

export function normalizeWalletPaymentDetails(input: {
  card_number: string;
  account_number: string;
  iban: string;
}): WalletPaymentDetails {
  const card = input.card_number.replace(/\D/g, '');
  const account = input.account_number.replace(/\D/g, '');
  let iban = input.iban.replace(/\s/g, '').toUpperCase();
  if (iban && !iban.startsWith('IR')) {
    iban = `IR${iban.replace(/^IR/i, '')}`;
  }

  return {
    card_number: card || null,
    account_number: account || null,
    iban: iban || null,
  };
}

export function formatCardNumber(value: string): string {
  return value.replace(/\D/g, '').replace(/(.{4})/g, '$1 ').trim();
}

export function formatIban(value: string): string {
  const raw = value.replace(/\s/g, '').toUpperCase();
  if (!raw) return '';
  const prefix = raw.startsWith('IR') ? 'IR' : '';
  const body = prefix ? raw.slice(2) : raw;
  const grouped = body.replace(/(.{4})/g, '$1 ').trim();
  return prefix ? `${prefix}${grouped ? ` ${grouped}` : ''}` : grouped;
}

export function paymentDetailsFormFromWallet(wallet: Wallet): {
  card_number: string;
  account_number: string;
  iban: string;
} {
  return {
    card_number: wallet.card_number ? formatCardNumber(wallet.card_number) : '',
    account_number: wallet.account_number ?? '',
    iban: wallet.iban ? formatIban(wallet.iban) : '',
  };
}
