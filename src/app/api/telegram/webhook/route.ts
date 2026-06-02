import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/shared/lib/supabase/admin';
import { consumeTelegramLinkToken } from '@/features/notifications/telegram/utils/link-token';
import { sendTelegramMessage } from '@/features/notifications/telegram/utils/telegram-client';
import {
  BOT_COMMANDS_HELP,
  handleBotCommand,
  sendWelcomeAfterLink,
} from '@/features/notifications/telegram/bot-commands';

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
  const message = update.message;
  if (!message?.text || !message.chat?.id) {
    return NextResponse.json({ ok: true });
  }

  const chatId = message.chat.id;
  const text = message.text.trim();

  if (text.startsWith('/start')) {
    const token = text.split(/\s+/)[1]?.trim();
    if (!token) {
      await sendTelegramMessage(
        chatId,
        `👋 سلام!\nبرای اتصال به خرجوک، از تنظیمات اپ «اتصال تلگرام» را بزنید.\n\n${BOT_COMMANDS_HELP}`
      );
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
    });

    if (connErr) {
      console.error(connErr);
      await sendTelegramMessage(chatId, '❌ خطا در اتصال. دوباره تلاش کنید.');
      return NextResponse.json({ ok: true });
    }

    await admin.from('notification_settings').upsert({
      user_id: consumed.userId,
      enabled: true,
      updated_at: new Date().toISOString(),
    });

    await sendWelcomeAfterLink(chatId);
    return NextResponse.json({ ok: true });
  }

  const handled = await handleBotCommand(chatId, text);
  if (!handled && text.startsWith('/')) {
    await sendTelegramMessage(
      chatId,
      `❓ دستور ناشناخته.\n\n${BOT_COMMANDS_HELP}`
    );
  }

  return NextResponse.json({ ok: true });
}
