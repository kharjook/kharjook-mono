import type { Wallet } from '@/shared/types/domain';
import {
  formatCardNumber,
  formatIban,
  walletHasPaymentDetails,
} from '@/features/wallets/utils/wallet-payment-details';
import {
  TELEGRAM_SEPARATOR,
} from '@/features/notifications/telegram/utils/format-helpers';
import type { TelegramInlineMarkup } from '@/features/notifications/telegram/utils/telegram-client';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function formatWalletPaymentInfoMessage(wallet: Wallet): string {
  const lines = [
    `🏦 <b>${escapeHtml(wallet.name)}</b>`,
    TELEGRAM_SEPARATOR,
  ];

  if (wallet.card_number) {
    lines.push('💳 <b>شماره کارت</b>', `<code>${escapeHtml(wallet.card_number)}</code>`, '');
  }
  if (wallet.account_number) {
    lines.push('🏧 <b>شماره حساب</b>', `<code>${escapeHtml(wallet.account_number)}</code>`, '');
  }
  if (wallet.iban) {
    lines.push('🔢 <b>شبا</b>', `<code>${escapeHtml(wallet.iban)}</code>`, '');
  }

  lines.push('👇 برای کپی روی دکمه بزنید یا روی متن ضربه بزنید.', TELEGRAM_SEPARATOR);
  return lines.join('\n').trim();
}

export function formatWalletPaymentInfoPlain(wallet: Wallet): string {
  const lines = [`🏦 ${wallet.name}`, TELEGRAM_SEPARATOR];
  if (wallet.card_number) {
    lines.push(`💳 کارت: ${formatCardNumber(wallet.card_number)}`, `   ${wallet.card_number}`, '');
  }
  if (wallet.account_number) {
    lines.push(`🏧 حساب: ${wallet.account_number}`, '');
  }
  if (wallet.iban) {
    lines.push(`🔢 شبا: ${formatIban(wallet.iban)}`, `   ${wallet.iban}`, '');
  }
  lines.push(TELEGRAM_SEPARATOR);
  return lines.join('\n').trim();
}

export function buildWalletPaymentCopyKeyboard(wallet: Wallet): TelegramInlineMarkup | null {
  if (!walletHasPaymentDetails(wallet)) return null;

  const rows: TelegramInlineMarkup['inline_keyboard'] = [];

  if (wallet.card_number) {
    rows.push([{ text: '📋 کپی شماره کارت', copy_text: { text: wallet.card_number } }]);
  }
  if (wallet.account_number) {
    rows.push([{ text: '📋 کپی شماره حساب', copy_text: { text: wallet.account_number } }]);
  }
  if (wallet.iban) {
    rows.push([{ text: '📋 کپی شبا', copy_text: { text: wallet.iban } }]);
  }

  return rows.length > 0 ? { inline_keyboard: rows } : null;
}

export function buildWalletInfoPickerKeyboard(wallets: Wallet[]): TelegramInlineMarkup {
  const rows = wallets.slice(0, 12).map((wallet) => [
    {
      text: wallet.name.slice(0, 32),
      callback_data: `wi:${wallet.id}`,
    },
  ]);
  return { inline_keyboard: rows };
}

export const MSG_WALLET_INFO_EMPTY =
  'ℹ️ برای این کیف پول اطلاعات حساب ثبت نشده.\nاز جزئیات کیف پول در اپ اضافه کنید.';
export const MSG_WALLET_INFO_PICK = '🏦 کیف پول را انتخاب کنید:';
export const MSG_NO_WALLETS = '❌ کیف پول فعالی ندارید.';
