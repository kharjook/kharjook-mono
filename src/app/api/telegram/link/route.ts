import { NextResponse } from 'next/server';
import {
  createTelegramLinkToken,
  getTelegramBotUsername,
} from '@/features/notifications/telegram/utils/link-token';
import {
  requireAuthUser,
  unauthorized,
} from '@/features/notifications/api/auth-helpers';

export const runtime = 'nodejs';

export async function POST() {
  const user = await requireAuthUser();
  if (!user) return unauthorized();

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return NextResponse.json({ error: 'Telegram bot is not configured' }, { status: 503 });
  }

  try {
    const token = await createTelegramLinkToken(user.id);
    const username = await getTelegramBotUsername();
    if (!username) {
      return NextResponse.json({ error: 'Could not resolve bot username' }, { status: 503 });
    }
    return NextResponse.json({
      linkUrl: `https://t.me/${username}?start=${token}`,
      expiresInMinutes: 15,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Failed to create link' }, { status: 500 });
  }
}
