import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/shared/lib/supabase/admin';
import { consumeTelegramLinkToken } from '@/features/notifications/telegram/utils/link-token';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
} from '@/features/notifications/services/dispatch-notifications';
import { sendTelegramMessage } from '@/features/notifications/telegram/utils/telegram-client';

export const runtime = 'nodejs';

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

  if (text === '/status') {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from('telegram_connections')
      .select('linked_at, is_active')
      .eq('telegram_chat_id', chatId)
      .maybeSingle();

    const row = data as { linked_at: string; is_active: boolean } | null;
    const reply = row?.is_active
      ? `✅ متصل به خرجوک\n🕐 از ${new Date(row.linked_at).toLocaleString('fa-IR')}`
      : '❌ هنوز به خرجوک متصل نشده‌اید.\nاز تنظیمات اپ، «اتصال تلگرام» را بزنید.';
    await sendTelegramMessage(chatId, reply);
    return NextResponse.json({ ok: true });
  }

  if (text.startsWith('/start')) {
    const token = text.split(/\s+/)[1]?.trim();
    if (!token) {
      await sendTelegramMessage(
        chatId,
        '👋 سلام!\nبرای اتصال به خرجوک، از تنظیمات اپ دکمه «اتصال تلگرام» را بزنید.'
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
      ...DEFAULT_NOTIFICATION_SETTINGS,
      updated_at: new Date().toISOString(),
    });

    await sendTelegramMessage(
      chatId,
      '✅ اتصال برقرار شد!\nاز این پس گزارش‌ها و یادآور اقساط را اینجا دریافت می‌کنید.'
    );
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}
