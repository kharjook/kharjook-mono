-- Remove deprecated TGJU price-source usage from assets.
-- Scope A: only remap assets.price_source_id values.
-- Run once in Supabase SQL editor.

update public.assets
set price_source_id = 'abantether.usdt'
where price_source_id = 'tgju.usd';

