-- Reconciliation note (added 2026-08-23):
-- Applied directly to production via Supabase MCP on 2026-08-23. Documented
-- here for migration history; safe/idempotent to re-run.
--
-- Feature (approved 2026-08-23): show all known shipping options in the
-- report (self-pickup, distribution point, courier), not just the
-- cheapest one used for shipping_price/total_price. Purely additive -
-- nullable columns, no default that could imply a false value, does not
-- touch shipping_price/total_price/shipping_known or the ranking logic
-- that still relies solely on those existing columns.

alter table public.price_offers
  add column if not exists shipping_pickup_price numeric,
  add column if not exists shipping_pickup_approved boolean,
  add column if not exists shipping_distribution_price numeric,
  add column if not exists shipping_courier_price numeric;

comment on column public.price_offers.shipping_pickup_price is
  'Self-pickup price if known, regardless of whether the carrying branch is in the approved area. Informational display only - see shipping_price for the ranking/total-price figure.';
comment on column public.price_offers.shipping_pickup_approved is
  'Whether the specific branch carrying this book is in the user-approved pickup area. Null if pickup price/branch unknown.';
comment on column public.price_offers.shipping_distribution_price is
  'Distribution-point shipping price if known. Informational display only.';
comment on column public.price_offers.shipping_courier_price is
  'Courier-to-door shipping price if known. Informational display only.';
