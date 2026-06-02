const TELEGRAM_API = 'https://api.telegram.org';

export type TelegramReplyMarkup = {
  keyboard: Array<Array<{ text: string }>>;
  resize_keyboard?: boolean;
  is_persistent?: boolean;
  input_field_placeholder?: string;
};

export type TelegramInlineButton =
  | { text: string; callback_data: string }
  | { text: string; copy_text: { text: string } };

export type TelegramInlineMarkup = {
  inline_keyboard: TelegramInlineButton[][];
};

export type TelegramParseMode = 'HTML' | 'Markdown' | 'MarkdownV2';

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

async function telegramPost(method: string, body: Record<string, unknown>): Promise<Response> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  return fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function sendTelegramMessage(
  chatId: number,
  text: string,
  replyMarkup?: TelegramReplyMarkup,
  options?: { parse_mode?: TelegramParseMode }
): Promise<void> {
  const res = await telegramPost('sendMessage', {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...(options?.parse_mode ? { parse_mode: options.parse_mode } : {}),
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
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

export async function sendTelegramInlineMessage(
  chatId: number,
  text: string,
  inlineMarkup: TelegramInlineMarkup,
  options?: { parse_mode?: TelegramParseMode }
): Promise<number | null> {
  const res = await telegramPost('sendMessage', {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...(options?.parse_mode ? { parse_mode: options.parse_mode } : {}),
    reply_markup: inlineMarkup,
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

  const payload = (await res.json()) as { result?: { message_id?: number } };
  return payload.result?.message_id ?? null;
}

export async function editTelegramMessage(
  chatId: number,
  messageId: number,
  text: string,
  inlineMarkup?: TelegramInlineMarkup
): Promise<void> {
  const res = await telegramPost('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    disable_web_page_preview: true,
    ...(inlineMarkup ? { reply_markup: inlineMarkup } : {}),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram edit failed (${res.status}): ${body}`);
  }
}

export async function answerTelegramCallback(
  callbackQueryId: string,
  text?: string
): Promise<void> {
  const res = await telegramPost('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
    show_alert: false,
  });
  if (!res.ok) {
    console.warn('answerCallbackQuery failed', await res.text());
  }
}

export async function setTelegramWebhook(webhookUrl: string): Promise<void> {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const res = await telegramPost('setWebhook', {
    url: webhookUrl,
    secret_token: secret || undefined,
    allowed_updates: ['message', 'callback_query'],
  });
  if (!res.ok) {
    throw new Error(`setWebhook failed: ${await res.text()}`);
  }
}
