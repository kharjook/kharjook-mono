export type ParsedBankSms = {
  txType: 'INCOME' | 'EXPENSE';
  amountToman: number;
  bankHint: string | null;
  note: string;
  confidence: 'high' | 'medium' | 'low';
};

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

function normalizeDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)));
}

function parseNumberToken(raw: string): number | null {
  const normalized = normalizeDigits(raw).replace(/[,،_\s]/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeForMatch(text: string): string {
  return normalizeDigits(text)
    .replace(/\u200c/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const INCOME_PATTERN =
  /واری[زز]|واري[زز]|دری[اا]فت|واریز به|سود(?:\s|$)|deposit|credit/i;
const EXPENSE_PATTERN =
  /برداشت|خری[دد]|خري[دد]|پرداخت|انتقال(?:\s+وجه|\s|$)|pos|خرید|purchase|withdraw/i;

const BANK_PATTERN =
  /بانک\s+[\u0600-\u06FFa-zA-Z]+|bank\s+[\w]+/i;

function detectTxType(text: string): 'INCOME' | 'EXPENSE' | null {
  const income = INCOME_PATTERN.test(text);
  const expense = EXPENSE_PATTERN.test(text);
  if (income && !expense) return 'INCOME';
  if (expense && !income) return 'EXPENSE';
  if (expense) return 'EXPENSE';
  if (income) return 'INCOME';
  return null;
}

function extractBankHint(text: string): string | null {
  const match = text.match(BANK_PATTERN);
  return match?.[0]?.trim() ?? null;
}

function extractNote(text: string, bankHint: string | null): string {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const skip = new Set(['بانک', 'کارت', 'مانده', 'موجودی', 'balance']);
  const useful = lines.filter((line) => {
    const lower = line.toLowerCase();
    if (bankHint && line.includes(bankHint)) return false;
    if (/^\*+\d+$/.test(line.replace(/\s/g, ''))) return false;
    if (/^[\d*]{4,}$/.test(line.replace(/\s/g, ''))) return false;
    if (skip.has(line)) return false;
    if (/^مبلغ/i.test(line)) return false;
    if (/^amount/i.test(line)) return false;
    if (/مانده|موجودی|balance/i.test(line)) return false;
    return line.length >= 3;
  });
  const note = useful.slice(0, 2).join(' · ').trim();
  return note.slice(0, 120);
}

function extractAmountToman(text: string): number | null {
  const normalized = normalizeForMatch(text);

  const tomanMatch = normalized.match(/([\d,،._\s]+)\s*تومان/i);
  if (tomanMatch) {
    return parseNumberToken(tomanMatch[1] ?? '');
  }

  const labeled = normalized.match(/(?:مبلغ|amount)[:\s-]*([\d,،._\s]+)/i);
  if (labeled) {
    const raw = parseNumberToken(labeled[1] ?? '');
    if (!raw) return null;
    if (/ریال|ريال|rial/i.test(normalized) && !/تومان/i.test(normalized)) {
      return raw / 10;
    }
    return raw >= 1_000_000 ? raw / 10 : raw;
  }

  const rialMatch = normalized.match(/([\d,،._\s]{3,})\s*(?:ریال|ريال|rial)/i);
  if (rialMatch) {
    const raw = parseNumberToken(rialMatch[1] ?? '');
    return raw ? raw / 10 : null;
  }

  const looseNumber = normalized.match(/([\d,،._\s]{4,})/);
  if (looseNumber) {
    const raw = parseNumberToken(looseNumber[1] ?? '');
    if (!raw) return null;
    if (/ریال|ريال|rial/i.test(normalized)) return raw / 10;
    if (/تومان/i.test(normalized)) return raw;
    return raw >= 1_000_000 ? raw / 10 : raw;
  }

  return null;
}

export function looksLikeBankSms(text: string): boolean {
  const normalized = normalizeForMatch(text);
  if (normalized.length < 20) return false;

  const signals = [
    /بانک/i,
    /کارت/i,
    /card/i,
    /ریال|ريال|rial/i,
    /تومان/i,
    /مبلغ/i,
    /amount/i,
    /حساب/i,
    /برداشت/,
    /واری[زز]|واري[زز]/,
    /خری[دد]|خري[دد]/,
    /پرداخت/,
    /انتقال/,
    /مانده/,
    /موجودی/,
    /balance/i,
  ];

  let hits = 0;
  for (const pattern of signals) {
    if (pattern.test(normalized)) hits += 1;
  }
  return hits >= 2;
}

export function parseBankSms(rawText: string): ParsedBankSms | null {
  const text = rawText.trim();
  if (!looksLikeBankSms(text)) return null;

  const normalized = normalizeForMatch(text);
  const amountToman = extractAmountToman(normalized);
  if (!amountToman || amountToman <= 0) return null;

  const txType = detectTxType(normalized) ?? 'EXPENSE';
  const bankHint = extractBankHint(normalized);
  const note = extractNote(text, bankHint) || bankHint || 'پیامک بانکی';

  let confidence: ParsedBankSms['confidence'] = 'low';
  if (detectTxType(normalized) && (bankHint || /مبلغ|amount|کارت|card/i.test(normalized))) {
    confidence = 'high';
  } else if (detectTxType(normalized) || bankHint) {
    confidence = 'medium';
  }

  return {
    txType,
    amountToman: Math.round(amountToman),
    bankHint,
    note,
    confidence,
  };
}
