import { createSupabaseAdminClient } from '@/shared/lib/supabase/admin';
import type { TelegramConnection } from '@/shared/types/domain';
import { sendTodayCashflowForUser } from '@/features/notifications/services/dispatch-notifications';
import { sendTelegramMessage } from '@/features/notifications/telegram/utils/telegram-client';
import {
  BOT_LINKED_SUCCESS,
  BOT_WELCOME_LINKED,
  BOT_WELCOME_UNLINKED,
  BTN_TODAY_CASHFLOW,
  buildMainReplyKeyboard,
} from '@/features/notifications/telegram/telegram-keyboard';

async function getConnectionByChatId(chatId: number): Promise<TelegramConnection | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from('telegram_connections')
    .select('*')
    .eq('telegram_chat_id', chatId)
    .eq('is_active', true)
    .maybeSingle();
  return (data as TelegramConnection | null) ?? null;
}

export async function sendBotMenu(chatId: number, text: string): Promise<void> {
  await sendTelegramMessage(chatId, text, buildMainReplyKeyboard());
}

export async function sendWelcomeAfterLink(chatId: number): Promise<void> {
  await sendBotMenu(chatId, `${BOT_LINKED_SUCCESS}\n\n${BOT_WELCOME_LINKED}`);
}

export async function sendUnlinkedPrompt(chatId: number): Promise<void> {
  await sendTelegramMessage(chatId, BOT_WELCOME_UNLINKED);
}

export async function handleBotMessage(chatId: number, text: string): Promise<void> {
  if (text === BTN_TODAY_CASHFLOW) {
    const connection = await getConnectionByChatId(chatId);
    if (!connection) {
      await sendUnlinkedPrompt(chatId);
      return;
    }

    await sendTelegramMessage(chatId, '⏳ در حال محاسبه...', buildMainReplyKeyboard());
    await sendTodayCashflowForUser(connection.user_id, connection, {
      replyMarkup: buildMainReplyKeyboard(),
    });
    return;
  }

  const connection = await getConnectionByChatId(chatId);
  if (connection) {
    await sendBotMenu(chatId, 'از دکمه زیر استفاده کنید 👇');
  } else {
    await sendUnlinkedPrompt(chatId);
  }
}
