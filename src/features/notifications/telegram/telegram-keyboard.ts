/** Label shown on the reply keyboard — also used to match incoming messages. */
export const BTN_TODAY_CASHFLOW = '📊 درآمد و هزینه امروز';

export function buildMainReplyKeyboard() {
  return {
    keyboard: [[{ text: BTN_TODAY_CASHFLOW }]],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: 'دکمه زیر را بزنید',
  };
}

export const BOT_WELCOME_LINKED = `👋 به خرجوک خوش آمدید!

برای دیدن درآمد و هزینه امروز، دکمه زیر را بزنید.

⏰ یادآور قسط‌های امروز (۹ صبح) از تنظیمات اپ قابل خاموش/روشن است.`;

export const BOT_WELCOME_UNLINKED = `👋 سلام!

برای استفاده از بات، ابتدا از تنظیمات اپ «اتصال تلگرام» را بزنید.`;

export const BOT_LINKED_SUCCESS = '✅ اتصال برقرار شد!';
