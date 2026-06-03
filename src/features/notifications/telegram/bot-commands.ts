import { sendCategoryCapsForUser } from '@/features/categories/services/category-cap-alerts';
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
  loadReportNotificationSettings,
  updateReportNotificationSettings,
} from '@/features/notifications/services/report-notification-settings';
import {
  getConnectionByChatId,
  getMenuStack,
  hintForMenu,
  keyboardForMenu,
  popMenu,
  pushMenu,
  resetMenuStack,
  setBotFlow,
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
  BTN_CASHFLOW_CAPS,
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
  BTN_QA_CANCEL,
  BTN_QA_EXPENSE,
  BTN_QA_INCOME,
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

async function settingsKeyboardForUser(userId: string) {
  const [botSettings, reportSettings] = await Promise.all([
    loadBotNotificationSettings(userId),
    loadReportNotificationSettings(userId),
  ]);
  return buildSettingsReplyKeyboard(
    botSettings.enabled,
    botSettings.price_alert_enabled,
    botSettings.expense_alert_enabled,
    reportSettings.report_enabled
  );
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
    const stack = await getMenuStack(chatId);
    const inQuickAddMenu = stack[stack.length - 1] === 'quick_add';
    let flow = connection.bot_flow as Record<string, unknown> | null;

    if (
      inQuickAddMenu &&
      !isQuickAddActive(flow) &&
      (text === BTN_QA_INCOME || text === BTN_QA_EXPENSE || text === BTN_QA_CANCEL)
    ) {
      flow = { type: 'quick_add', step: 'type' };
      await setBotFlow(chatId, flow);
    }

    if (isQuickAddActive(flow) || (inQuickAddMenu && flow?.type === 'quick_add')) {
      const handled = await handleQuickAddMessage(
        chatId,
        text,
        connection,
        (flow ?? { type: 'quick_add', step: 'type' }) as QuickAddFlow
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
    await pushMenu(chatId, 'settings');
    await sendTelegramMessage(
      chatId,
      hintForMenu('settings'),
      await settingsKeyboardForUser(conn.user_id)
    );
    return;
  }

  if (text === BTN_QUICK_ADD) {
    if (!(await requireConnection(chatId))) return;
    try {
      await startQuickAddFlow(chatId);
    } catch (err) {
      console.error('startQuickAddFlow failed', err);
      await sendTelegramMessage(chatId, MSG_ERROR_GENERIC, buildMainReplyKeyboard());
    }
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

  if (text === BTN_CASHFLOW_CAPS) {
    await runCashflowAction(chatId, async (userId, conn) => {
      await sendCategoryCapsForUser(userId, conn);
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
    (text.startsWith('🔔 یادآور قسط:') ||
      text.startsWith('📈 هشدار قیمت:') ||
      text.startsWith('🔴 اعلان هزینه:') ||
      text.startsWith('📬 گزارش خودکار:'))
  ) {
    const settings = await loadBotNotificationSettings(connection.user_id);
    if (text.startsWith('🔔')) {
      await updateBotNotificationSettings(connection.user_id, {
        enabled: !settings.enabled,
      });
    } else if (text.startsWith('📈')) {
      await updateBotNotificationSettings(connection.user_id, {
        price_alert_enabled: !settings.price_alert_enabled,
      });
    } else if (text.startsWith('🔴')) {
      await updateBotNotificationSettings(connection.user_id, {
        expense_alert_enabled: !settings.expense_alert_enabled,
      });
    } else {
      const report = await loadReportNotificationSettings(connection.user_id);
      await updateReportNotificationSettings(connection.user_id, {
        report_enabled: !report.report_enabled,
      });
    }
    await sendTelegramMessage(
      chatId,
      MSG_SETTINGS_SAVED,
      await settingsKeyboardForUser(connection.user_id)
    );
    return;
  }

  if (ALL_BOT_BUTTONS.has(text)) return;

  if (connection) {
    const stack = await getMenuStack(chatId);
    const menu = stack[stack.length - 1] ?? 'main';
    if (menu === 'settings') {
      await sendTelegramMessage(
        chatId,
        MSG_USE_MENU,
        await settingsKeyboardForUser(connection.user_id)
      );
    } else {
      await sendTelegramMessage(chatId, MSG_USE_MENU, keyboardForMenu(menu));
    }
  } else {
    await sendUnlinkedPrompt(chatId);
  }
}
