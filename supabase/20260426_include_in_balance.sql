-- Per-asset flag: exclude market value from total portfolio balance (dashboard).
-- Default true = included everywhere until user opts out.
-- Run once in Supabase SQL editor.

alter table public.assets
  add column if not exists include_in_balance boolean not null default true;

comment on column public.assets.include_in_balance is
  'When false, current market value is omitted from total balance and distribution chart; still shown on asset screens.';
