-- Reconciliation note (added 2026-08-14, no re-run against production):
-- Applied directly to production on 2026-07-21, reproduced verbatim from
-- supabase_migrations.schema_migrations.statements. Do not re-apply.

-- Restrict daily price snapshots to books that are still being sought.

create or replace function public.snapshot_daily_prices(target_user uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  insert into public.price_history (
    user_id, book_id, offer_id, captured_on, item_price, shipping_price,
    total_price, source, source_url, condition, location, seller_name,
    ad_image_url, is_removed, paid_price
  )
  select
    offers.user_id, offers.book_id, offers.id, (timezone('Asia/Jerusalem', now()))::date,
    offers.item_price, offers.shipping_price, offers.total_price,
    offers.source, offers.source_url, offers.condition, offers.location,
    offers.seller_name, offers.ad_image_url, offers.is_removed,
    books.purchase_price
  from public.price_offers offers
  join public.books on books.id = offers.book_id
  where books.status not in ('השגתי', 'סל מחזור')
    and (target_user is null or offers.user_id = target_user)
  on conflict (offer_id, captured_on) do update set
    item_price = excluded.item_price,
    shipping_price = excluded.shipping_price,
    total_price = excluded.total_price,
    is_removed = excluded.is_removed,
    paid_price = excluded.paid_price;

  insert into public.daily_book_prices (
    user_id, book_id, offer_id, captured_on, item_price, shipping_price,
    total_price, source, source_url, condition, location, seller_name,
    ad_image_url, paid_price
  )
  select distinct on (offers.book_id)
    offers.user_id, offers.book_id, offers.id, (timezone('Asia/Jerusalem', now()))::date,
    offers.item_price, offers.shipping_price, offers.total_price,
    offers.source, offers.source_url, offers.condition, offers.location,
    offers.seller_name, offers.ad_image_url, books.purchase_price
  from public.price_offers offers
  join public.books on books.id = offers.book_id
  where books.status not in ('השגתי', 'סל מחזור')
    and offers.active = true
    and offers.is_removed = false
    and offers.total_price is not null
    and (target_user is null or offers.user_id = target_user)
  order by offers.book_id, offers.total_price asc, offers.updated_at desc
  on conflict (book_id, captured_on) do update set
    offer_id = excluded.offer_id,
    item_price = excluded.item_price,
    shipping_price = excluded.shipping_price,
    total_price = excluded.total_price,
    source = excluded.source,
    source_url = excluded.source_url,
    condition = excluded.condition,
    location = excluded.location,
    seller_name = excluded.seller_name,
    ad_image_url = excluded.ad_image_url,
    paid_price = excluded.paid_price;

  get diagnostics affected = row_count;
  return affected;
end $$;

revoke all on function public.snapshot_daily_prices(uuid) from public;
grant execute on function public.snapshot_daily_prices(uuid) to service_role;
