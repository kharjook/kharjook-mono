import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/shared/lib/supabase/admin';
import { consumeTelegramLinkToken } from '@/features/notifications/telegram/utils/link-token';
import { sendTelegramMessage } from '@/features/notifications/telegram/utils/telegram-client';
import { handleBotCallback } from '@/features/notifications/telegram/bot-callbacks';
import {
  handleBotMessage,
  sendBotMenu,
  sendUnlinkedPrompt,
  sendWelcomeAfterLink,
} from '@/features/notifications/telegram/bot-commands';
import { BOT_WELCOME_LINKED } from '@/features/notifications/telegram/telegram-keyboard';
import { MSG_ERROR_GENERIC } from '@/features/notifications/telegram/utils/telegram-copy';

export const runtime = 'nodejs';

/** Browser GET is not how Telegram delivers updates — this is only a health check. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    message: 'Kharjook Telegram webhook is live. Telegram sends POST here, not GET.',
  });
}

type TelegramUpdate = {
  message?: {
    chat: { id: number };
    from?: { id: number; username?: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { message_id?: number; chat?: { id?: number } };
  };
};

export async function POST(request: Request) {
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (webhookSecret) {
    const header = request.headers.get('x-telegram-bot-api-secret-token');
    if (header !== webhookSecret) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const update = (await request.json()) as TelegramUpdate;

  if (update.callback_query?.data) {
    const chatId = update.callback_query.message?.chat?.id;
    if (chatId) {
      try {
        await handleBotCallback({
          chatId,
          data: update.callback_query.data,
          callbackQueryId: update.callback_query.id,
          messageId: update.callback_query.message?.message_id,
        });
      } catch (err) {
        console.error('Telegram callback failed', err);
        const detail = err instanceof Error ? err.message : MSG_ERROR_GENERIC;
        await sendTelegramMessage(chatId, `❌ ${MSG_ERROR_GENERIC}\n${detail.slice(0, 200)}`);
      }
    }
    return NextResponse.json({ ok: true });
  }

  const message = update.message;
  if (!message?.text || !message.chat?.id) {
    return NextResponse.json({ ok: true });
  }

  const chatId = message.chat.id;
  const text = message.text.trim();

  if (text.startsWith('/start')) {
    const token = text.split(/\s+/)[1]?.trim();
    if (!token) {
      const admin = createSupabaseAdminClient();
      const { data } = await admin
        .from('telegram_connections')
        .select('id')
        .eq('telegram_chat_id', chatId)
        .eq('is_active', true)
        .maybeSingle();

      if (data) {
        await sendBotMenu(chatId, BOT_WELCOME_LINKED);
      } else {
        await sendUnlinkedPrompt(chatId);
      }
      return NextResponse.json({ ok: true });
    }

    const consumed = await consumeTelegramLinkToken(token);
    if (!consumed) {
      await sendTelegramMessage(chatId, '❌ لینک نامعتبر یا منقضی شده. دوباره از اپ تلاش کنید.');
      return NextResponse.json({ ok: true });
    }

    const admin = createSupabaseAdminClient();
    await admin.from('telegram_connections').delete().eq('telegram_chat_id', chatId);

    const { error: connErr } = await admin.from('telegram_connections').upsert({
      user_id: consumed.userId,
      telegram_chat_id: chatId,
      telegram_user_id: message.from?.id ?? null,
      telegram_username: message.from?.username ?? null,
      is_active: true,
      linked_at: new Date().toISOString(),
      menu_stack: ['main'],
      bot_flow: null,
    });

    if (connErr) {
      console.error(connErr);
      await sendTelegramMessage(chatId, '❌ خطا در اتصال. دوباره تلاش کنید.');
      return NextResponse.json({ ok: true });
    }

    await admin.from('notification_settings').upsert({
      user_id: consumed.userId,
      enabled: true,
      price_alert_enabled: false,
      expense_alert_enabled: false,
      updated_at: new Date().toISOString(),
    });

    await sendWelcomeAfterLink(chatId);
    return NextResponse.json({ ok: true });
  }

  await handleBotMessage(chatId, text);
  return NextResponse.json({ ok: true });
}
