const TELEGRAM_API = 'https://api.telegram.org';

export type TelegramReplyMarkup = {
  keyboard: Array<Array<{ text: string }>>;
  resize_keyboard?: boolean;
  is_persistent?: boolean;
  input_field_placeholder?: string;
};

export class TelegramSendError extends Error {
  constructor(
    message: string,
    readonly chatId: number,
    readonly blocked: boolean
  ) {
    super(message);
    this.name = 'TelegramSendError';
  }
}

export async function sendTelegramMessage(
  chatId: number,
  text: string,
  replyMarkup?: TelegramReplyMarkup
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured');

  const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    const blocked =
      res.status === 403 ||
      body.includes('bot was blocked') ||
      body.includes('user is deactivated');
    throw new TelegramSendError(
      `Telegram send failed (${res.status}): ${body}`,
      chatId,
      blocked
    );
  }
}

export async function setTelegramWebhook(webhookUrl: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured');

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const res = await fetch(`${TELEGRAM_API}/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secret || undefined,
      allowed_updates: ['message'],
    }),
  });
  if (!res.ok) {
    throw new Error(`setWebhook failed: ${await res.text()}`);
  }
}
