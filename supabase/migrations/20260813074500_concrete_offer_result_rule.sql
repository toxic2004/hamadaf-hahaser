begin;

alter table public.price_offers
  add column if not exists availability_status text;

alter table public.price_offers
  drop constraint if exists price_offers_availability_status_check;

alter table public.price_offers
  add constraint price_offers_availability_status_check
  check (
    availability_status is null
    or availability_status in ('במלאי', 'לא במלאי')
  );

alter table public.price_offers
  drop constraint if exists price_offers_concrete_result_check;

alter table public.price_offers
  add constraint price_offers_concrete_result_check
  check (
    availability_status is null
    or (
      item_price is not null
      and item_price >= 0
      and source_url ~* '^https?://'
    )
  ) not valid;

comment on column public.price_offers.availability_status is
  'מצב מלאי מאומת. רק במלאי או לא במלאי. ערך חסר אינו תוצאה להצגה בדוח.';

commit;
