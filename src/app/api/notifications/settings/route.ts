import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/shared/lib/supabase/server';
import { DEFAULT_NOTIFICATION_SETTINGS } from '@/features/notifications/services/dispatch-notifications';
import {
  requireAuthUser,
  unauthorized,
} from '@/features/notifications/api/auth-helpers';

export const runtime = 'nodejs';

export async function GET() {
  const user = await requireAuthUser();
  if (!user) return unauthorized();

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('notification_settings')
    .select('enabled, updated_at')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
  }

  return NextResponse.json({
    settings: {
      enabled: data?.enabled ?? DEFAULT_NOTIFICATION_SETTINGS.enabled,
      updated_at: data?.updated_at ?? null,
    },
  });
}

export async function PUT(request: Request) {
  const user = await requireAuthUser();
  if (!user) return unauthorized();

  const body = (await request.json()) as { enabled?: boolean };
  const enabled = body.enabled ?? DEFAULT_NOTIFICATION_SETTINGS.enabled;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('notification_settings')
    .upsert(
      {
        user_id: user.id,
        enabled,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
    .select('enabled, updated_at')
    .single();

  if (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }

  return NextResponse.json({ settings: data });
}
