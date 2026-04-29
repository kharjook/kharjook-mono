-- Per-asset UI decimal precision for quantity display.
-- IMPORTANT: this is display-only and does not change stored transaction values.
-- Run once in Supabase SQL editor.

alter table public.assets
  add column if not exists decimal_places integer;

update public.assets
set decimal_places = 4
where decimal_places is null;

alter table public.assets
  alter column decimal_places set default 4;

alter table public.assets
  alter column decimal_places set not null;

alter table public.assets
  drop constraint if exists assets_decimal_places_check;

alter table public.assets
  add constraint assets_decimal_places_check
  check (decimal_places >= 0 and decimal_places <= 12);

comment on column public.assets.decimal_places is
  'Display precision for asset quantities in UI only; values are truncated to this precision for rendering.';
