import { createSupabaseAdminClient } from '@/shared/lib/supabase/admin';
import type { TelegramConnection } from '@/shared/types/domain';
import {
  sendDailyReportForUser,
  sendDebtsListForUser,
} from '@/features/notifications/services/dispatch-notifications';
import { sendTelegramMessage } from '@/features/notifications/telegram/utils/telegram-client';
import { TELEGRAM_SEPARATOR } from '@/features/notifications/telegram/utils/format-helpers';

export const BOT_COMMANDS_HELP = `📖 دستورات خرجوک

/report — گزارش مالی (امروز، ماه، پرتفolio)
/debts — لیست بدهی‌ها و اقساط
/status — وضعیت اتصال
/help — همین راهنما

⏰ لیست بدهی‌ها هر روز ساعت ۹ صبح (خودکار) ارسال می‌شود — از تنظیمات اپ قابل خاموش/روشن است.`;

async function getConnectionByChatId(
  chatId: number
): Promise<TelegramConnection | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from('telegram_connections')
    .select('*')
    .eq('telegram_chat_id', chatId)
    .eq('is_active', true)
    .maybeSingle();
  return (data as TelegramConnection | null) ?? null;
}

export async function handleBotCommand(chatId: number, text: string): Promise<boolean> {
  const command = text.split(/\s+/)[0]?.split('@')[0]?.toLowerCase();
  if (!command?.startsWith('/')) return false;

  if (command === '/help') {
    await sendTelegramMessage(chatId, BOT_COMMANDS_HELP);
    return true;
  }

  if (command === '/status') {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from('telegram_connections')
      .select('linked_at, is_active')
      .eq('telegram_chat_id', chatId)
      .maybeSingle();

    const row = data as { linked_at: string; is_active: boolean } | null;
    const reply = row?.is_active
      ? `✅ متصل به خرجوک\n🕐 از ${new Date(row.linked_at).toLocaleString('fa-IR')}\n\n${TELEGRAM_SEPARATOR}\n${BOT_COMMANDS_HELP}`
      : '❌ هنوز به خرجوک متصل نشده‌اید.\nاز تنظیمات اپ، «اتصال تلگرام» را بزنید.';
    await sendTelegramMessage(chatId, reply);
    return true;
  }

  const connection = await getConnectionByChatId(chatId);
  if (!connection && (command === '/report' || command === '/debts')) {
    await sendTelegramMessage(
      chatId,
      '❌ ابتدا از تنظیمات اپ، «اتصال تلگرام» را انجام دهید.'
    );
    return true;
  }

  if (command === '/report' && connection) {
    await sendTelegramMessage(chatId, '⏳ در حال آماده‌سازی گزارش...');
    await sendDailyReportForUser(connection.user_id, connection);
    return true;
  }

  if (command === '/debts' && connection) {
    await sendDebtsListForUser(connection.user_id, connection, { skipDedup: true });
    return true;
  }

  return false;
}

export async function sendWelcomeAfterLink(chatId: number): Promise<void> {
  await sendTelegramMessage(
    chatId,
    `✅ اتصال برقرار شد!

${BOT_COMMANDS_HELP}`
  );
}
