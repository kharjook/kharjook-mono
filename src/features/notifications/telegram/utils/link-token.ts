import crypto from 'node:crypto';
import { createSupabaseAdminClient } from '@/shared/lib/supabase/admin';

const TOKEN_TTL_MS = 15 * 60 * 1000;

function randomToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

export async function createTelegramLinkToken(userId: string): Promise<string> {
  const admin = createSupabaseAdminClient();
  const token = randomToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

  await admin.from('telegram_link_tokens').delete().eq('user_id', userId);
  const { error } = await admin.from('telegram_link_tokens').insert({
    token,
    user_id: userId,
    expires_at: expiresAt,
  });
  if (error) throw error;
  return token;
}

export async function consumeTelegramLinkToken(
  token: string
): Promise<{ userId: string } | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('telegram_link_tokens')
    .select('user_id, expires_at, used_at')
    .eq('token', token)
    .maybeSingle();

  if (error || !data || data.used_at) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) return null;

  const { error: markErr } = await admin
    .from('telegram_link_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('token', token);
  if (markErr) return null;

  return { userId: data.user_id as string };
}

export async function getTelegramBotUsername(): Promise<string | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  if (!res.ok) return null;
  const json = (await res.json()) as { ok?: boolean; result?: { username?: string } };
  return json.ok ? (json.result?.username ?? null) : null;
}
