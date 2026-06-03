import { settleLoanInstallment } from '@/features/deadlines/services/settle-loan-installment';
import { createSupabaseAdminClient } from '@/shared/lib/supabase/admin';
import type { TelegramConnection, Wallet } from '@/shared/types/domain';
import { clearBotFlow, getConnectionByChatId, setBotFlow } from '@/features/notifications/telegram/bot-nav';
import { handleQuickAddCallback } from '@/features/notifications/telegram/bot-quick-add';
import { handleSmsImportCallback } from '@/features/notifications/telegram/bot-sms-import';
import { undoLastBotTransaction } from '@/features/notifications/services/bot-undo-transaction';
import { handleWalletInfoCallback } from '@/features/notifications/services/bot-wallet-info';
import {
  answerTelegramCallback,
  editTelegramMessage,
  sendTelegramInlineMessage,
  type TelegramInlineMarkup,
} from '@/features/notifications/telegram/utils/telegram-client';
import {
  MSG_SETTLE_ALREADY,
  MSG_SETTLE_OK,
  MSG_TX_UNDONE,
} from '@/features/notifications/telegram/utils/telegram-copy';

type PayInstallmentFlow = {
  type: 'pay_installment';
  installmentId: string;
  walletIds: string[];
};

function truncate(text: string, max = 24): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

async function loadActiveWallets(userId: string): Promise<Wallet[]> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from('wallets')
    .select('*')
    .eq('user_id', userId)
    .is('archived_at', null)
    .order('order_index', { ascending: true, nullsFirst: false });
  return (data ?? []) as Wallet[];
}

function walletPickKeyboard(wallets: Wallet[]): TelegramInlineMarkup {
  const rows = wallets.slice(0, 8).map((wallet, index) => [
    { text: truncate(wallet.name), callback_data: `pw:${index}` },
  ]);
  rows.push([{ text: '❌ لغو', callback_data: 'pw:cancel' }]);
  return { inline_keyboard: rows };
}

async function handlePayInstallmentStart(
  chatId: number,
  connection: TelegramConnection,
  installmentId: string,
  callbackQueryId: string,
  messageId?: number
): Promise<void> {
  const wallets = await loadActiveWallets(connection.user_id);
  if (wallets.length === 0) {
    await answerTelegramCallback(callbackQueryId, 'کیف پول فعالی ندارید.');
    return;
  }

  if (wallets.length === 1) {
    const result = await settleLoanInstallment({
      userId: connection.user_id,
      installmentId,
      walletId: wallets[0]!.id,
    });
    if (result.ok) {
      await answerTelegramCallback(callbackQueryId, MSG_SETTLE_OK);
      if (messageId) {
        await editTelegramMessage(chatId, messageId, `✅ ${MSG_SETTLE_OK}`);
      }
    } else {
      await answerTelegramCallback(
        callbackQueryId,
        result.code === 'already_paid' ? MSG_SETTLE_ALREADY : result.error
      );
    }
    return;
  }

  await setBotFlow(chatId, {
    type: 'pay_installment',
    installmentId,
    walletIds: wallets.map((w) => w.id),
  });

  await answerTelegramCallback(callbackQueryId);
  const text = '👛 کیف پول پرداخت را انتخاب کنید:';
  if (messageId) {
    await editTelegramMessage(chatId, messageId, text, walletPickKeyboard(wallets));
  } else {
    await sendTelegramInlineMessage(chatId, text, walletPickKeyboard(wallets));
  }
}

async function handlePayWalletPick(
  chatId: number,
  connection: TelegramConnection,
  walletIndex: number,
  callbackQueryId: string,
  messageId?: number
): Promise<void> {
  const flow = connection.bot_flow as PayInstallmentFlow | null;
  if (!flow || flow.type !== 'pay_installment') {
    await answerTelegramCallback(callbackQueryId, 'جلسه منقضی شد.');
    return;
  }

  const walletId = flow.walletIds[walletIndex];
  if (!walletId) {
    await answerTelegramCallback(callbackQueryId, 'کیف پول نامعتبر.');
    return;
  }

  const result = await settleLoanInstallment({
    userId: connection.user_id,
    installmentId: flow.installmentId,
    walletId,
  });

  await clearBotFlow(chatId);

  if (result.ok) {
    await answerTelegramCallback(callbackQueryId, MSG_SETTLE_OK);
    if (messageId) {
      await editTelegramMessage(chatId, messageId, `✅ ${MSG_SETTLE_OK}`);
    }
    return;
  }

  await answerTelegramCallback(
    callbackQueryId,
    result.code === 'already_paid' ? MSG_SETTLE_ALREADY : result.error
  );
}

export async function handleBotCallback(input: {
  chatId: number;
  data: string;
  callbackQueryId: string;
  messageId?: number;
}): Promise<void> {
  const connection = await getConnectionByChatId(input.chatId);
  if (!connection) {
    await answerTelegramCallback(input.callbackQueryId, 'ابتدا از اپ وصل شوید.');
    return;
  }

  const { data, callbackQueryId, chatId, messageId } = input;

  if (data === 'undo:last') {
    const result = await undoLastBotTransaction(connection.user_id);
    await answerTelegramCallback(callbackQueryId, result.ok ? MSG_TX_UNDONE : result.error);
    if (messageId) {
      await editTelegramMessage(
        chatId,
        messageId,
        result.ok ? `✅ ${MSG_TX_UNDONE}` : `❌ ${result.error}`
      );
    }
    return;
  }

  if (data.startsWith('qa:')) {
    await handleQuickAddCallback(chatId, data, connection, callbackQueryId, messageId);
    return;
  }

  if (data.startsWith('si:')) {
    await handleSmsImportCallback(chatId, data, connection, callbackQueryId, messageId);
    return;
  }

  if (data.startsWith('pi:')) {
    const installmentId = data.slice(3);
    await handlePayInstallmentStart(chatId, connection, installmentId, callbackQueryId, messageId);
    return;
  }

  if (data === 'pw:cancel') {
    await clearBotFlow(chatId);
    await answerTelegramCallback(callbackQueryId, 'لغو شد.');
    if (messageId) {
      await editTelegramMessage(chatId, messageId, '❌ پرداخت لغو شد.');
    }
    return;
  }

  if (data.startsWith('pw:')) {
    const fresh = await getConnectionByChatId(chatId);
    if (!fresh) return;
    const index = Number(data.slice(3));
    await handlePayWalletPick(chatId, fresh, index, callbackQueryId, messageId);
    return;
  }

  if (data.startsWith('wi:')) {
    const walletId = data.slice(3);
    await answerTelegramCallback(callbackQueryId);
    await handleWalletInfoCallback(connection, walletId);
    return;
  }

  await answerTelegramCallback(callbackQueryId);
}
