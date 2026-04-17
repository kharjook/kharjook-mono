const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_INDIC_DIGITS =
  '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669';

/**
 * Converts Persian / Arabic-Indic digits (and Arabic decimal mark) to ASCII.
 * Non-digit characters are preserved — useful for dates and pasted input.
 */
export function latinizeDigits(input: unknown): string {
  if (input == null) return '';
  const s = String(input).replace(/\u066b/g, '.');
  let out = '';
  for (const ch of s) {
    const pi = PERSIAN_DIGITS.indexOf(ch);
    if (pi !== -1) {
      out += String(pi);
      continue;
    }
    const ai = ARABIC_INDIC_DIGITS.indexOf(ch);
    if (ai !== -1) {
      out += String(ai);
      continue;
    }
    out += ch;
  }
  return out;
}
