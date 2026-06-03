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
    .select('enabled, price_alert_enabled, expense_alert_enabled, updated_at')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
  }

  const row = data as {
    enabled?: boolean;
    price_alert_enabled?: boolean;
    expense_alert_enabled?: boolean;
    updated_at?: string | null;
  } | null;

  return NextResponse.json({
    settings: {
      enabled: row?.enabled ?? DEFAULT_NOTIFICATION_SETTINGS.enabled,
      price_alert_enabled:
        row?.price_alert_enabled ?? DEFAULT_NOTIFICATION_SETTINGS.price_alert_enabled,
      expense_alert_enabled:
        row?.expense_alert_enabled ?? DEFAULT_NOTIFICATION_SETTINGS.expense_alert_enabled,
      updated_at: row?.updated_at ?? null,
    },
  });
}

export async function PUT(request: Request) {
  const user = await requireAuthUser();
  if (!user) return unauthorized();

  const body = (await request.json()) as {
    enabled?: boolean;
    price_alert_enabled?: boolean;
    expense_alert_enabled?: boolean;
  };

  const supabase = await createSupabaseServerClient();
  const { data: existing, error: loadError } = await supabase
    .from('notification_settings')
    .select('enabled, price_alert_enabled, expense_alert_enabled')
    .eq('user_id', user.id)
    .maybeSingle();

  if (loadError) {
    console.error(loadError);
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
  }

  const row = existing as {
    enabled?: boolean;
    price_alert_enabled?: boolean;
    expense_alert_enabled?: boolean;
  } | null;

  const current = {
    enabled: row?.enabled ?? DEFAULT_NOTIFICATION_SETTINGS.enabled,
    price_alert_enabled:
      row?.price_alert_enabled ?? DEFAULT_NOTIFICATION_SETTINGS.price_alert_enabled,
    expense_alert_enabled:
      row?.expense_alert_enabled ?? DEFAULT_NOTIFICATION_SETTINGS.expense_alert_enabled,
  };

  const next = {
    enabled: body.enabled !== undefined ? body.enabled : current.enabled,
    price_alert_enabled:
      body.price_alert_enabled !== undefined
        ? body.price_alert_enabled
        : current.price_alert_enabled,
    expense_alert_enabled:
      body.expense_alert_enabled !== undefined
        ? body.expense_alert_enabled
        : current.expense_alert_enabled,
  };

  const { data, error } = await supabase
    .from('notification_settings')
    .upsert(
      {
        user_id: user.id,
        enabled: next.enabled,
        price_alert_enabled: next.price_alert_enabled,
        expense_alert_enabled: next.expense_alert_enabled,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
    .select('enabled, price_alert_enabled, expense_alert_enabled, updated_at')
    .single();

  if (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }

  return NextResponse.json({ settings: data });
}
