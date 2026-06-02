import { createSupabaseAdminClient } from '@/shared/lib/supabase/admin';
import type { TelegramConnection, Wallet } from '@/shared/types/domain';
import {
  buildWalletInfoPickerKeyboard,
  buildWalletPaymentCopyKeyboard,
  formatWalletPaymentInfoMessage,
  MSG_NO_WALLETS,
  MSG_WALLET_INFO_EMPTY,
  MSG_WALLET_INFO_PICK,
} from '@/features/notifications/telegram/utils/format-wallet-payment-info';
import {
  sendTelegramInlineMessage,
  sendTelegramMessage,
  type TelegramReplyMarkup,
} from '@/features/notifications/telegram/utils/telegram-client';
import { walletHasPaymentDetails } from '@/features/wallets/utils/wallet-payment-details';

async function loadActiveWallets(userId: string): Promise<Wallet[]> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from('wallets')
    .select('*')
    .eq('user_id', userId)
    .is('archived_at', null)
    .order('order_index', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  return (data ?? []) as Wallet[];
}

async function loadWallet(userId: string, walletId: string): Promise<Wallet | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from('wallets')
    .select('*')
    .eq('id', walletId)
    .eq('user_id', userId)
    .is('archived_at', null)
    .maybeSingle();
  return (data as Wallet | null) ?? null;
}

export async function sendWalletPaymentInfoPicker(
  connection: TelegramConnection,
  options?: { replyMarkup?: TelegramReplyMarkup }
): Promise<void> {
  const wallets = await loadActiveWallets(connection.user_id);
  if (wallets.length === 0) {
    await sendTelegramMessage(connection.telegram_chat_id, MSG_NO_WALLETS, options?.replyMarkup);
    return;
  }

  if (wallets.length === 1) {
    await sendWalletPaymentInfoForWallet(connection, wallets[0]!.id);
    return;
  }

  await sendTelegramInlineMessage(
    connection.telegram_chat_id,
    MSG_WALLET_INFO_PICK,
    buildWalletInfoPickerKeyboard(wallets)
  );
}

export async function sendWalletPaymentInfoForWallet(
  connection: TelegramConnection,
  walletId: string
): Promise<void> {
  const wallet = await loadWallet(connection.user_id, walletId);
  if (!wallet) {
    await sendTelegramMessage(connection.telegram_chat_id, '❌ کیف پول پیدا نشد.');
    return;
  }

  if (!walletHasPaymentDetails(wallet)) {
    await sendTelegramMessage(
      connection.telegram_chat_id,
      `${MSG_WALLET_INFO_EMPTY}\n\n👛 ${wallet.name}`
    );
    return;
  }

  const text = formatWalletPaymentInfoMessage(wallet);
  const keyboard = buildWalletPaymentCopyKeyboard(wallet);

  if (keyboard) {
    await sendTelegramInlineMessage(connection.telegram_chat_id, text, keyboard, {
      parse_mode: 'HTML',
    });
  } else {
    await sendTelegramMessage(connection.telegram_chat_id, text, undefined, {
      parse_mode: 'HTML',
    });
  }
}

export async function handleWalletInfoCallback(
  connection: TelegramConnection,
  walletId: string
): Promise<void> {
  await sendWalletPaymentInfoForWallet(connection, walletId);
}
