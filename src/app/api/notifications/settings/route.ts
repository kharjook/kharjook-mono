import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/shared/lib/supabase/server';
import type { NotificationSettings } from '@/shared/types/domain';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
} from '@/features/notifications/services/dispatch-notifications';
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
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
  }

  const settings: NotificationSettings = data
    ? (data as NotificationSettings)
    : {
        user_id: user.id,
        ...DEFAULT_NOTIFICATION_SETTINGS,
        updated_at: new Date().toISOString(),
      };

  return NextResponse.json({ settings });
}

export async function PUT(request: Request) {
  const user = await requireAuthUser();
  if (!user) return unauthorized();

  const body = (await request.json()) as Partial<NotificationSettings>;
  const payload = {
    user_id: user.id,
    enabled: body.enabled ?? DEFAULT_NOTIFICATION_SETTINGS.enabled,
    report_enabled: body.report_enabled ?? DEFAULT_NOTIFICATION_SETTINGS.report_enabled,
    report_interval: body.report_interval ?? DEFAULT_NOTIFICATION_SETTINGS.report_interval,
    report_day_of_week:
      body.report_day_of_week ?? DEFAULT_NOTIFICATION_SETTINGS.report_day_of_week,
    report_time: normalizeTime(body.report_time ?? DEFAULT_NOTIFICATION_SETTINGS.report_time),
    timezone: body.timezone ?? DEFAULT_NOTIFICATION_SETTINGS.timezone,
    show_portfolio_irt:
      body.show_portfolio_irt ?? DEFAULT_NOTIFICATION_SETTINGS.show_portfolio_irt,
    show_portfolio_usd:
      body.show_portfolio_usd ?? DEFAULT_NOTIFICATION_SETTINGS.show_portfolio_usd,
    show_cashflow_irt:
      body.show_cashflow_irt ?? DEFAULT_NOTIFICATION_SETTINGS.show_cashflow_irt,
    show_cashflow_usd:
      body.show_cashflow_usd ?? DEFAULT_NOTIFICATION_SETTINGS.show_cashflow_usd,
    updated_at: new Date().toISOString(),
  };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('notification_settings')
    .upsert(payload)
    .select('*')
    .single();

  if (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }

  return NextResponse.json({ settings: data });
}

function normalizeTime(value: string): string {
  if (/^\d{2}:\d{2}:\d{2}$/.test(value)) return value;
  if (/^\d{2}:\d{2}$/.test(value)) return `${value}:00`;
  return DEFAULT_NOTIFICATION_SETTINGS.report_time;
}
