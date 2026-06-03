import { createSupabaseAdminClient } from '@/shared/lib/supabase/admin';
import type { Category, TelegramConnection, Wallet } from '@/shared/types/domain';
import { createBotWalletTransaction } from '@/features/notifications/services/bot-quick-add-transaction';
import { resolveQuickAddPref, saveQuickAddPref } from '@/features/notifications/services/bot-quick-add-prefs';
import { saveUndoLast } from '@/features/notifications/services/bot-undo-transaction';
import {
  clearBotFlow,
  getConnectionByChatId,
  setBotFlow,
} from '@/features/notifications/telegram/bot-nav';
import {
  buildMainReplyKeyboard,
  BTN_SMS_IMPORT,
} from '@/features/notifications/telegram/telegram-keyboard';
import {
  MSG_ERROR_NO_CATEGORIES,
  MSG_ERROR_NO_WALLETS,
  MSG_FLOW_CANCELLED,
  MSG_TX_SAVED,
} from '@/features/notifications/telegram/utils/telegram-copy';
import { formatTelegramMoney } from '@/features/notifications/telegram/utils/format-helpers';
import {
  parseBankSms,
  type ParsedBankSms,
} from '@/features/notifications/telegram/utils/parse-bank-sms';
import {
  answerTelegramCallback,
  editTelegramMessage,
  sendTelegramInlineMessage,
  sendTelegramMessage,
  type TelegramInlineMarkup,
} from '@/features/notifications/telegram/utils/telegram-client';

export type SmsImportFlow = {
  type: 'sms_import';
  step: 'awaiting' | 'wallet' | 'category' | 'confirm';
  txType: 'INCOME' | 'EXPENSE';
  amountToman: number;
  note: string;
  bankHint?: string | null;
  walletId?: string;
  categoryId?: string;
  walletIds?: string[];
  categoryIds?: string[];
};

const SMS_PROMPT =
  '📩 متن پیامک بانکی را اینجا بفرستید (فوروارد یا کپی).\n\nمثال: خرید، برداشت، واریز با مبلغ به ریال یا تومان.';

function parseFlow(raw: Record<string, unknown> | null): SmsImportFlow | null {
  if (!raw || raw.type !== 'sms_import') return null;
  return raw as unknown as SmsImportFlow;
}

export function isSmsImportActive(raw: Record<string, unknown> | null): boolean {
  return raw?.type === 'sms_import';
}

function truncate(text: string, max = 24): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

async function loadWallets(userId: string): Promise<Wallet[]> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from('wallets')
    .select('*')
    .eq('user_id', userId)
    .is('archived_at', null)
    .order('order_index', { ascending: true, nullsFirst: false });
  return (data ?? []) as Wallet[];
}

async function loadCategories(userId: string, kind: 'income' | 'expense'): Promise<Category[]> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from('categories')
    .select('*')
    .eq('user_id', userId)
    .eq('kind', kind)
    .order('order_index', { ascending: true, nullsFirst: false });
  return (data ?? []) as Category[];
}

function walletInlineKeyboard(wallets: Wallet[]): TelegramInlineMarkup {
  const rows = wallets.slice(0, 8).map((wallet, index) => [
    { text: truncate(wallet.name), callback_data: `si:w:${index}` },
  ]);
  rows.push([{ text: '❌ لغو', callback_data: 'si:cancel' }]);
  return { inline_keyboard: rows };
}

function categoryInlineKeyboard(categories: Category[]): TelegramInlineMarkup {
  const rows = categories.slice(0, 8).map((category, index) => [
    { text: truncate(category.name), callback_data: `si:c:${index}` },
  ]);
  rows.push([{ text: '❌ لغو', callback_data: 'si:cancel' }]);
  return { inline_keyboard: rows };
}

function confirmInlineKeyboard(): TelegramInlineMarkup {
  return {
    inline_keyboard: [
      [
        { text: '✅ ثبت', callback_data: 'si:yes' },
        { text: '🔄 تغییر کیف/دسته', callback_data: 'si:change' },
      ],
      [{ text: '❌ لغو', callback_data: 'si:cancel' }],
    ],
  };
}

async function buildPreviewText(flow: SmsImportFlow, userId: string): Promise<string> {
  const lines = [
    '📩 ثبت از پیامک بانکی',
    '',
    flow.txType === 'INCOME' ? '💚 درآمد' : '🔴 هزینه',
    `💰 ${formatTelegramMoney(flow.amountToman, 'TOMAN')}`,
  ];
  if (flow.bankHint) lines.push(`🏦 ${flow.bankHint}`);
  if (flow.note) lines.push(`📝 ${truncate(flow.note, 80)}`);

  if (flow.walletId && flow.categoryId) {
    const admin = createSupabaseAdminClient();
    const [{ data: walletRow }, { data: categoryRow }] = await Promise.all([
      admin.from('wallets').select('name').eq('id', flow.walletId).maybeSingle(),
      admin.from('categories').select('name').eq('id', flow.categoryId).maybeSingle(),
    ]);
    if (walletRow?.name) lines.push(`👛 ${walletRow.name}`);
    if (categoryRow?.name) lines.push(`🏷 ${categoryRow.name}`);
  }

  lines.push('', '✅ ثبت این تراکنش؟');
  return lines.join('\n');
}

async function editOrSendInline(
  chatId: number,
  messageId: number | undefined,
  text: string,
  markup: TelegramInlineMarkup
): Promise<void> {
  if (messageId) {
    try {
      await editTelegramMessage(chatId, messageId, text, markup);
      return;
    } catch {
      // fall through
    }
  }
  await sendTelegramInlineMessage(chatId, text, markup);
}

async function proceedToConfirmOrPickers(
  chatId: number,
  connection: TelegramConnection,
  base: Omit<SmsImportFlow, 'step'>,
  messageId?: number
): Promise<void> {
  const pref = await resolveQuickAddPref(connection.user_id, base.txType);
  if (pref) {
    const next: SmsImportFlow = {
      ...base,
      step: 'confirm',
      walletId: pref.walletId,
      categoryId: pref.categoryId,
    };
    await setBotFlow(chatId, next);
    const text = await buildPreviewText(next, connection.user_id);
    await editOrSendInline(chatId, messageId, `${text}\n\n⚡ کیف و دسته از آخرین ثبت`, confirmInlineKeyboard());
    return;
  }

  const wallets = await loadWallets(connection.user_id);
  if (wallets.length === 0) {
    await clearBotFlow(chatId);
    await sendTelegramMessage(chatId, MSG_ERROR_NO_WALLETS, buildMainReplyKeyboard());
    return;
  }

  const next: SmsImportFlow = {
    ...base,
    step: 'wallet',
    walletIds: wallets.map((wallet) => wallet.id),
  };
  await setBotFlow(chatId, next);
  await sendTelegramInlineMessage(
    chatId,
    `👛 کیف پول را انتخاب کنید\n💰 ${formatTelegramMoney(base.amountToman, 'TOMAN')}`,
    walletInlineKeyboard(wallets)
  );
}

export async function startSmsImportPrompt(chatId: number): Promise<void> {
  await setBotFlow(chatId, {
    type: 'sms_import',
    step: 'awaiting',
    txType: 'EXPENSE',
    amountToman: 0,
    note: '',
  });
  await sendTelegramMessage(chatId, SMS_PROMPT, buildMainReplyKeyboard());
}

export async function cancelSmsImportFlow(chatId: number): Promise<void> {
  await clearBotFlow(chatId);
  await sendTelegramMessage(chatId, MSG_FLOW_CANCELLED, buildMainReplyKeyboard());
}

export async function startSmsImportFromParse(
  chatId: number,
  connection: TelegramConnection,
  parsed: ParsedBankSms
): Promise<void> {
  await proceedToConfirmOrPickers(chatId, connection, {
    type: 'sms_import',
    txType: parsed.txType,
    amountToman: parsed.amountToman,
    note: parsed.note,
    bankHint: parsed.bankHint,
  });
}

export async function handleSmsImportMessage(
  chatId: number,
  text: string,
  connection: TelegramConnection,
  flow: SmsImportFlow
): Promise<boolean> {
  if (flow.step !== 'awaiting') return false;
  if (text === BTN_SMS_IMPORT) return false;

  const parsed = parseBankSms(text);
  if (!parsed) {
    await sendTelegramMessage(
      chatId,
      '❌ پیامک شناسایی نشد. مبلغ و نوع تراکنش (خرید/برداشت/واریز) باید مشخص باشد.',
      buildMainReplyKeyboard()
    );
    return true;
  }

  await startSmsImportFromParse(chatId, connection, parsed);
  return true;
}

export async function tryAutoParseBankSms(
  chatId: number,
  connection: TelegramConnection,
  text: string
): Promise<boolean> {
  const parsed = parseBankSms(text);
  if (!parsed || parsed.confidence === 'low') return false;
  await startSmsImportFromParse(chatId, connection, parsed);
  return true;
}

export async function handleSmsImportCallback(
  chatId: number,
  data: string,
  connection: TelegramConnection,
  callbackQueryId: string,
  messageId?: number
): Promise<boolean> {
  if (!data.startsWith('si:')) return false;

  const fresh = await getConnectionByChatId(chatId);
  const flow = parseFlow((fresh?.bot_flow as Record<string, unknown> | null) ?? null);
  if (!flow || flow.type !== 'sms_import') {
    await answerTelegramCallback(callbackQueryId, 'جلسه منقضی شد.');
    return true;
  }

  if (data === 'si:cancel') {
    await answerTelegramCallback(callbackQueryId);
    await cancelSmsImportFlow(chatId);
    return true;
  }

  if (data === 'si:change') {
    const wallets = await loadWallets(connection.user_id);
    if (wallets.length === 0) {
      await answerTelegramCallback(callbackQueryId, MSG_ERROR_NO_WALLETS);
      return true;
    }
    const next: SmsImportFlow = {
      ...flow,
      step: 'wallet',
      walletId: undefined,
      categoryId: undefined,
      walletIds: wallets.map((wallet) => wallet.id),
      categoryIds: undefined,
    };
    await setBotFlow(chatId, next);
    await answerTelegramCallback(callbackQueryId);
    await editOrSendInline(
      chatId,
      messageId,
      `👛 کیف پول را انتخاب کنید\n💰 ${formatTelegramMoney(flow.amountToman, 'TOMAN')}`,
      walletInlineKeyboard(wallets)
    );
    return true;
  }

  if (data === 'si:yes') {
    if (!flow.walletId || !flow.categoryId) {
      await answerTelegramCallback(callbackQueryId, 'اطلاعات ناقص است.');
      return true;
    }
    const result = await createBotWalletTransaction({
      userId: connection.user_id,
      type: flow.txType,
      amountToman: flow.amountToman,
      walletId: flow.walletId,
      categoryId: flow.categoryId,
      note: flow.note,
    });
    await answerTelegramCallback(callbackQueryId, result.ok ? MSG_TX_SAVED : result.error);
    if (messageId) {
      await editTelegramMessage(
        chatId,
        messageId,
        result.ok ? `✅ ${MSG_TX_SAVED}` : `❌ ${result.error}`
      );
    }
    if (result.ok) {
      await saveQuickAddPref(connection.user_id, flow.txType, {
        walletId: flow.walletId,
        categoryId: flow.categoryId,
      });
      await saveUndoLast(connection.user_id, result.transactionId);
      await sendTelegramInlineMessage(chatId, 'تا ۵ دقیقه می‌توانید این ثبت را لغو کنید:', {
        inline_keyboard: [[{ text: '↩️ لغو ثبت', callback_data: 'undo:last' }]],
      });
    }
    await clearBotFlow(chatId);
    await sendTelegramMessage(chatId, 'منوی اصلی 👇', buildMainReplyKeyboard());
    return true;
  }

  if (data.startsWith('si:w:')) {
    const index = Number(data.slice(5));
    const walletId = flow.walletIds?.[index];
    if (!walletId) {
      await answerTelegramCallback(callbackQueryId, 'کیف پول نامعتبر.');
      return true;
    }
    const kind = flow.txType === 'INCOME' ? 'income' : 'expense';
    const categories = await loadCategories(connection.user_id, kind);
    if (categories.length === 0) {
      await answerTelegramCallback(callbackQueryId, MSG_ERROR_NO_CATEGORIES);
      return true;
    }
    const next: SmsImportFlow = {
      ...flow,
      step: 'category',
      walletId,
      categoryIds: categories.map((category) => category.id),
    };
    await setBotFlow(chatId, next);
    await answerTelegramCallback(callbackQueryId);
    await editOrSendInline(
      chatId,
      messageId,
      '🏷 دسته‌بندی را انتخاب کنید:',
      categoryInlineKeyboard(categories)
    );
    return true;
  }

  if (data.startsWith('si:c:')) {
    const index = Number(data.slice(5));
    const categoryId = flow.categoryIds?.[index];
    if (!categoryId || !flow.walletId) {
      await answerTelegramCallback(callbackQueryId, 'دسته نامعتبر.');
      return true;
    }
    const next: SmsImportFlow = {
      ...flow,
      step: 'confirm',
      categoryId,
    };
    await setBotFlow(chatId, next);
    await answerTelegramCallback(callbackQueryId);
    const text = await buildPreviewText(next, connection.user_id);
    await editOrSendInline(chatId, messageId, text, confirmInlineKeyboard());
    return true;
  }

  return false;
}
