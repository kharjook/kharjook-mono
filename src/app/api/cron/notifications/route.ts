import { NextResponse } from 'next/server';
import { processScheduledNotifications } from '@/features/notifications/services/dispatch-notifications';
import { verifyCronSecret } from '@/features/notifications/api/auth-helpers';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const result = await processScheduledNotifications();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 });
  }
}
