import type { TelegramReplyMarkup } from '@/features/notifications/telegram/utils/telegram-client';

export type BotMenuId = 'main' | 'cashflow' | 'reports' | 'prices' | 'settings' | 'quick_add';

/** Main menu */
export const BTN_MENU_CASHFLOW = '📊 درآمد و هزینه';
export const BTN_MENU_REPORTS = '📋 گزارش‌ها';
export const BTN_MENU_PRICES = '💰 قیمت‌ها';
export const BTN_QUICK_ADD = '⚡ ثبت سریع';
export const BTN_MENU_SETTINGS = '⚙️ تنظیمات';

/** Cashflow submenu */
export const BTN_CASHFLOW_TODAY = '📅 امروز';
export const BTN_CASHFLOW_MONTH = '📆 این ماه';
export const BTN_CASHFLOW_CAPS = '🎯 سقف دسته‌ها';

/** Reports submenu */
export const BTN_PORTFOLIO = '💼 ارزش پرتفوی';
export const BTN_MONTH_DEBTS = '📅 اقساط این ماه';
export const BTN_OVERDUE_DEBTS = '🔴 اقساط معوق';
export const BTN_WALLET_BALANCES = '💳 موجودی کیف‌ها';
export const BTN_WALLET_PAYMENT_INFO = '🏦 اطلاعات حساب';

/** Prices submenu */
export const BTN_UPDATE_PRICES = '🔄 بروزرسانی قیمت‌ها';
export const BTN_GET_PRICES = '📈 مشاهده قیمت‌ها';

/** Quick add */
export const BTN_QA_INCOME = '💚 درآمد';
export const BTN_QA_EXPENSE = '🔴 هزینه';
export const BTN_QA_CANCEL = '❌ لغو';

/** Settings toggles — labels built dynamically */
export const BTN_BACK = '🔙 بازگشت';

export const ALL_BOT_BUTTONS = new Set([
  BTN_MENU_CASHFLOW,
  BTN_MENU_REPORTS,
  BTN_MENU_PRICES,
  BTN_QUICK_ADD,
  BTN_MENU_SETTINGS,
  BTN_CASHFLOW_TODAY,
  BTN_CASHFLOW_MONTH,
  BTN_CASHFLOW_CAPS,
  BTN_PORTFOLIO,
  BTN_MONTH_DEBTS,
  BTN_OVERDUE_DEBTS,
  BTN_WALLET_BALANCES,
  BTN_WALLET_PAYMENT_INFO,
  BTN_UPDATE_PRICES,
  BTN_GET_PRICES,
  BTN_QA_INCOME,
  BTN_QA_EXPENSE,
  BTN_QA_CANCEL,
  BTN_BACK,
]);

export function settingsToggleDebtLabel(enabled: boolean): string {
  return enabled ? '🔔 یادآور قسط: روشن' : '🔔 یادآور قسط: خاموش';
}

export function settingsTogglePriceLabel(enabled: boolean): string {
  return enabled ? '📈 هشدار قیمت: روشن' : '📈 هشدار قیمت: خاموش';
}

export function settingsToggleExpenseLabel(enabled: boolean): string {
  return enabled ? '🔴 اعلان هزینه: روشن' : '🔴 اعلان هزینه: خاموش';
}

export function buildMainReplyKeyboard(): TelegramReplyMarkup {
  return {
    keyboard: [
      [{ text: BTN_MENU_CASHFLOW }, { text: BTN_QUICK_ADD }],
      [{ text: BTN_MENU_REPORTS }, { text: BTN_MENU_PRICES }],
      [{ text: BTN_MENU_SETTINGS }],
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: 'منو را انتخاب کنید',
  };
}

export function buildCashflowReplyKeyboard(): TelegramReplyMarkup {
  return {
    keyboard: [
      [{ text: BTN_CASHFLOW_TODAY }, { text: BTN_CASHFLOW_MONTH }],
      [{ text: BTN_CASHFLOW_CAPS }],
      [{ text: BTN_BACK }],
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: 'بازه را انتخاب کنید',
  };
}

export function buildReportsReplyKeyboard(): TelegramReplyMarkup {
  return {
    keyboard: [
      [{ text: BTN_PORTFOLIO }, { text: BTN_WALLET_BALANCES }],
      [{ text: BTN_MONTH_DEBTS }, { text: BTN_OVERDUE_DEBTS }],
      [{ text: BTN_WALLET_PAYMENT_INFO }],
      [{ text: BTN_BACK }],
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: 'گزارش را انتخاب کنید',
  };
}

export function buildPricesReplyKeyboard(): TelegramReplyMarkup {
  return {
    keyboard: [[{ text: BTN_UPDATE_PRICES }, { text: BTN_GET_PRICES }], [{ text: BTN_BACK }]],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: 'عملیات قیمت',
  };
}

export function settingsToggleReportLabel(enabled: boolean): string {
  return enabled ? '📬 گزارش خودکار: روشن' : '📬 گزارش خودکار: خاموش';
}

export function buildSettingsReplyKeyboard(
  debtEnabled: boolean,
  priceAlertEnabled: boolean,
  expenseAlertEnabled: boolean,
  reportEnabled: boolean
): TelegramReplyMarkup {
  return {
    keyboard: [
      [{ text: settingsToggleDebtLabel(debtEnabled) }],
      [{ text: settingsTogglePriceLabel(priceAlertEnabled) }],
      [{ text: settingsToggleExpenseLabel(expenseAlertEnabled) }],
      [{ text: settingsToggleReportLabel(reportEnabled) }],
      [{ text: BTN_BACK }],
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: 'تنظیمات',
  };
}

export function buildQuickAddReplyKeyboard(): TelegramReplyMarkup {
  return {
    keyboard: [[{ text: BTN_QA_INCOME }, { text: BTN_QA_EXPENSE }], [{ text: BTN_QA_CANCEL }]],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: 'نوع تراکنش',
  };
}

export const BOT_WELCOME_LINKED = `👋 به خرجوک خوش آمدید!

منوی اصلی به‌روز شد. اگر دکمه‌ها قدیمی‌اند /start بزنید.

• درآمد/هزینه · ثبت سریع · گزارش‌ها · قیمت‌ها · تنظیمات

⏰ یادآور قسط‌های امروز ساعت ۹ صبح — از تنظیمات.`;

export const BOT_WELCOME_UNLINKED = `👋 سلام!

برای استفاده از بات، ابتدا از تنظیمات اپ «اتصال تلگرام» را بزنید.`;

export const BOT_LINKED_SUCCESS = '✅ اتصال برقرار شد!';

export const BOT_CASHFLOW_MENU_HINT = '📊 بازه درآمد و هزینه:';
export const BOT_REPORTS_MENU_HINT = '📋 یک گزارش انتخاب کنید:';
export const BOT_PRICES_MENU_HINT = '💰 عملیات قیمت:';
export const BOT_SETTINGS_MENU_HINT = '⚙️ تنظیمات اعلان‌ها:';
export const BOT_QUICK_ADD_HINT = '⚡ نوع تراکنش را انتخاب کنید:';

export const BOT_QA_AMOUNT_PROMPT = '💰 مبلغ را به تومان وارد کنید:';
export const BOT_QA_CONFIRM_PROMPT = '✅ ثبت این تراکنش؟';
