import {
  refreshAndReportPricesForUser,
  sendMonthCashflowForUser,
  sendMonthDebtsForUser,
  sendOverdueDebtsForUser,
  sendPortfolioForUser,
  sendPricesListForUser,
  sendTodayCashflowForUser,
  sendWalletBalancesForUser,
} from '@/features/notifications/services/dispatch-notifications';
import { sendWalletPaymentInfoPicker } from '@/features/notifications/services/bot-wallet-info';
import {
  loadBotNotificationSettings,
  updateBotNotificationSettings,
} from '@/features/notifications/services/bot-notification-settings';
import {
  getConnectionByChatId,
  getMenuStack,
  hintForMenu,
  keyboardForMenu,
  popMenu,
  pushMenu,
  resetMenuStack,
} from '@/features/notifications/telegram/bot-nav';
import {
  cancelQuickAddFlow,
  handleQuickAddMessage,
  isQuickAddActive,
  startQuickAddFlow,
  type QuickAddFlow,
} from '@/features/notifications/telegram/bot-quick-add';
import {
  ALL_BOT_BUTTONS,
  BOT_LINKED_SUCCESS,
  BOT_WELCOME_LINKED,
  BOT_WELCOME_UNLINKED,
  BTN_BACK,
  BTN_CASHFLOW_MONTH,
  BTN_CASHFLOW_TODAY,
  BTN_GET_PRICES,
  BTN_MENU_CASHFLOW,
  BTN_MENU_PRICES,
  BTN_MENU_REPORTS,
  BTN_MENU_SETTINGS,
  BTN_MONTH_DEBTS,
  BTN_OVERDUE_DEBTS,
  BTN_PORTFOLIO,
  BTN_QUICK_ADD,
  BTN_UPDATE_PRICES,
  BTN_WALLET_BALANCES,
  BTN_WALLET_PAYMENT_INFO,
  buildMainReplyKeyboard,
  buildSettingsReplyKeyboard,
} from '@/features/notifications/telegram/telegram-keyboard';
import {
  MSG_ERROR_GENERIC,
  MSG_LOADING_CALC,
  MSG_LOADING_FETCH,
  MSG_LOADING_PRICES,
  MSG_MAIN_MENU,
  MSG_SETTINGS_SAVED,
  MSG_USE_MENU,
  msgPriceRefreshFailed,
} from '@/features/notifications/telegram/utils/telegram-copy';
import { sendTelegramMessage } from '@/features/notifications/telegram/utils/telegram-client';

export { getConnectionByChatId };

export async function sendBotMenu(chatId: number, text: string): Promise<void> {
  await resetMenuStack(chatId);
  await sendTelegramMessage(chatId, text, buildMainReplyKeyboard());
}

export async function sendWelcomeAfterLink(chatId: number): Promise<void> {
  await sendBotMenu(chatId, `${BOT_LINKED_SUCCESS}\n\n${BOT_WELCOME_LINKED}`);
}

export async function sendUnlinkedPrompt(chatId: number): Promise<void> {
  await sendTelegramMessage(chatId, BOT_WELCOME_UNLINKED);
}

async function requireConnection(chatId: number) {
  const connection = await getConnectionByChatId(chatId);
  if (!connection) await sendUnlinkedPrompt(chatId);
  return connection;
}

async function openSubmenu(chatId: number, menu: 'cashflow' | 'reports' | 'prices' | 'settings'): Promise<void> {
  await pushMenu(chatId, menu);
  await sendTelegramMessage(chatId, hintForMenu(menu), keyboardForMenu(menu));
}

async function handleBack(chatId: number): Promise<void> {
  const connection = await requireConnection(chatId);
  if (!connection) return;

  if (isQuickAddActive((connection.bot_flow as Record<string, unknown> | null) ?? null)) {
    await cancelQuickAddFlow(chatId);
    return;
  }

  const menu = await popMenu(chatId);
  await sendTelegramMessage(chatId, hintForMenu(menu), keyboardForMenu(menu));
}

async function runReportAction(
  chatId: number,
  action: (userId: string, connection: NonNullable<Awaited<ReturnType<typeof requireConnection>>>) => Promise<void>
): Promise<void> {
  const connection = await requireConnection(chatId);
  if (!connection) return;
  const keyboard = keyboardForMenu('reports');
  await sendTelegramMessage(chatId, MSG_LOADING_FETCH, keyboard);
  try {
    await action(connection.user_id, connection);
  } catch {
    await sendTelegramMessage(chatId, MSG_ERROR_GENERIC, keyboard);
  }
}

async function runCashflowAction(
  chatId: number,
  action: (userId: string, connection: NonNullable<Awaited<ReturnType<typeof requireConnection>>>) => Promise<void>
): Promise<void> {
  const connection = await requireConnection(chatId);
  if (!connection) return;
  const keyboard = keyboardForMenu('cashflow');
  await sendTelegramMessage(chatId, MSG_LOADING_CALC, keyboard);
  try {
    await action(connection.user_id, connection);
  } catch {
    await sendTelegramMessage(chatId, MSG_ERROR_GENERIC, keyboard);
  }
}

export async function handleBotMessage(chatId: number, text: string): Promise<void> {
  const connection = await getConnectionByChatId(chatId);

  if (connection) {
    const flow = connection.bot_flow as Record<string, unknown> | null;
    if (isQuickAddActive(flow)) {
      const handled = await handleQuickAddMessage(
        chatId,
        text,
        connection,
        flow as unknown as QuickAddFlow
      );
      if (handled) return;
    }
  }

  if (text === BTN_MENU_CASHFLOW) {
    if (!(await requireConnection(chatId))) return;
    await openSubmenu(chatId, 'cashflow');
    return;
  }

  if (text === BTN_MENU_REPORTS) {
    if (!(await requireConnection(chatId))) return;
    await openSubmenu(chatId, 'reports');
    return;
  }

  if (text === BTN_MENU_PRICES) {
    if (!(await requireConnection(chatId))) return;
    await openSubmenu(chatId, 'prices');
    return;
  }

  if (text === BTN_MENU_SETTINGS) {
    const conn = await requireConnection(chatId);
    if (!conn) return;
    const settings = await loadBotNotificationSettings(conn.user_id);
    await pushMenu(chatId, 'settings');
    await sendTelegramMessage(
      chatId,
      hintForMenu('settings'),
      buildSettingsReplyKeyboard(settings.enabled, settings.price_alert_enabled)
    );
    return;
  }

  if (text === BTN_QUICK_ADD) {
    if (!(await requireConnection(chatId))) return;
    await startQuickAddFlow(chatId);
    return;
  }

  if (text === BTN_BACK) {
    await handleBack(chatId);
    return;
  }

  if (text === BTN_CASHFLOW_TODAY) {
    await runCashflowAction(chatId, async (userId, conn) => {
      await sendTodayCashflowForUser(userId, conn, {
        replyMarkup: keyboardForMenu('cashflow'),
      });
    });
    return;
  }

  if (text === BTN_CASHFLOW_MONTH) {
    await runCashflowAction(chatId, async (userId, conn) => {
      await sendMonthCashflowForUser(userId, conn, {
        replyMarkup: keyboardForMenu('cashflow'),
      });
    });
    return;
  }

  if (text === BTN_PORTFOLIO) {
    await runReportAction(chatId, async (userId, conn) => {
      await sendPortfolioForUser(userId, conn, { replyMarkup: keyboardForMenu('reports') });
    });
    return;
  }

  if (text === BTN_WALLET_BALANCES) {
    await runReportAction(chatId, async (userId, conn) => {
      await sendWalletBalancesForUser(userId, conn, { replyMarkup: keyboardForMenu('reports') });
    });
    return;
  }

  if (text === BTN_WALLET_PAYMENT_INFO) {
    await runReportAction(chatId, async (_userId, conn) => {
      await sendWalletPaymentInfoPicker(conn, {
        replyMarkup: keyboardForMenu('reports'),
      });
    });
    return;
  }

  if (text === BTN_MONTH_DEBTS) {
    await runReportAction(chatId, async (userId, conn) => {
      await sendMonthDebtsForUser(userId, conn, { replyMarkup: keyboardForMenu('reports') });
    });
    return;
  }

  if (text === BTN_OVERDUE_DEBTS) {
    await runReportAction(chatId, async (userId, conn) => {
      await sendOverdueDebtsForUser(userId, conn, {
        replyMarkup: keyboardForMenu('reports'),
        withPayButtons: true,
      });
    });
    return;
  }

  if (text === BTN_UPDATE_PRICES) {
    const conn = await requireConnection(chatId);
    if (!conn) return;
    const keyboard = keyboardForMenu('prices');
    await sendTelegramMessage(chatId, MSG_LOADING_PRICES, keyboard);
    try {
      await refreshAndReportPricesForUser(conn.user_id, conn, { replyMarkup: keyboard });
    } catch (err) {
      const detail = err instanceof Error ? err.message : MSG_ERROR_GENERIC;
      await sendTelegramMessage(chatId, msgPriceRefreshFailed(detail), keyboard);
    }
    return;
  }

  if (text === BTN_GET_PRICES) {
    await runReportAction(chatId, async (userId, conn) => {
      await sendPricesListForUser(userId, conn, { replyMarkup: keyboardForMenu('prices') });
    });
    return;
  }

  if (
    connection &&
    (text.startsWith('🔔 یادآور قسط:') || text.startsWith('📈 هشدار قیمت:'))
  ) {
    const settings = await loadBotNotificationSettings(connection.user_id);
    if (text.startsWith('🔔')) {
      const next = await updateBotNotificationSettings(connection.user_id, {
        enabled: !settings.enabled,
      });
      await sendTelegramMessage(
        chatId,
        MSG_SETTINGS_SAVED,
        buildSettingsReplyKeyboard(next.enabled, next.price_alert_enabled)
      );
    } else {
      const next = await updateBotNotificationSettings(connection.user_id, {
        price_alert_enabled: !settings.price_alert_enabled,
      });
      await sendTelegramMessage(
        chatId,
        MSG_SETTINGS_SAVED,
        buildSettingsReplyKeyboard(next.enabled, next.price_alert_enabled)
      );
    }
    return;
  }

  if (ALL_BOT_BUTTONS.has(text)) return;

  if (connection) {
    const stack = await getMenuStack(chatId);
    const menu = stack[stack.length - 1] ?? 'main';
    if (menu === 'settings') {
      const settings = await loadBotNotificationSettings(connection.user_id);
      await sendTelegramMessage(chatId, MSG_USE_MENU, buildSettingsReplyKeyboard(settings.enabled, settings.price_alert_enabled));
    } else {
      await sendTelegramMessage(chatId, MSG_USE_MENU, keyboardForMenu(menu));
    }
  } else {
    await sendUnlinkedPrompt(chatId);
  }
}
