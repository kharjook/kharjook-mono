import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/shared/lib/supabase/server';
import {
  requireAuthUser,
  unauthorized,
} from '@/features/notifications/api/auth-helpers';

export const runtime = 'nodejs';

export async function POST() {
  const user = await requireAuthUser();
  if (!user) return unauthorized();

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('telegram_connections')
    .delete()
    .eq('user_id', user.id);

  if (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to disconnect' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function GET() {
  const user = await requireAuthUser();
  if (!user) return unauthorized();

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('telegram_connections')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to load connection' }, { status: 500 });
  }

  return NextResponse.json({ connection: data });
}
