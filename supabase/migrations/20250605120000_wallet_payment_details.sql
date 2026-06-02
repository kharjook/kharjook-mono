-- Optional payment destination fields for wallets

ALTER TABLE wallets
  ADD COLUMN IF NOT EXISTS card_number text,
  ADD COLUMN IF NOT EXISTS account_number text,
  ADD COLUMN IF NOT EXISTS iban text;
