-- רדאר המדף: פונקציית "קניתי" אטומית.
-- כפתור "קניתי" חייב לעדכן שתי טבלאות (manual_offers + books) יחד - אם
-- זה נעשה כשתי קריאות נפרדות מה-JS, כישלון בקריאה השנייה משאיר מצב
-- סותר (הצעה מסומנת "נקנתה" אבל הספר עדיין "מחפש", או להפך). הפונקציה
-- הזו עושה את כל השינוי בטרנזקציה אחת: או הכול, או כלום.

create or replace function public.mark_manual_offer_purchased(
  p_offer_id uuid,
  p_purchased_price numeric,
  p_purchased_from text default null,
  p_purchased_at timestamptz default now()
)
returns public.manual_offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_book_id text;
  v_owner uuid;
  v_result public.manual_offers;
begin
  select book_id, user_id into v_book_id, v_owner
  from public.manual_offers
  where id = p_offer_id;

  if v_book_id is null then
    raise exception 'manual_offers row % not found', p_offer_id;
  end if;

  if v_owner <> auth.uid() then
    raise exception 'not authorized to update this offer';
  end if;

  if p_purchased_price is null or p_purchased_price < 0 then
    raise exception 'purchased_price is required and must be >= 0';
  end if;

  -- Everything below runs in one transaction: either the purchase closes
  -- out completely and consistently, or none of it happens at all.

  update public.manual_offers
  set status = 'נקנתה',
      purchased_at = p_purchased_at,
      purchased_price = p_purchased_price,
      purchased_from = p_purchased_from,
      updated_at = now()
  where id = p_offer_id
  returning * into v_result;

  update public.manual_offers
  set status = 'לא רלוונטית',
      updated_at = now()
  where book_id = v_book_id
    and id <> p_offer_id
    and status = 'פעילה';

  -- Only the status column on books ever changes here, and only via this
  -- function - never any other field.
  update public.books
  set status = 'השגתי'
  where id = v_book_id
    and user_id = auth.uid();

  return v_result;
end;
$$;

comment on function public.mark_manual_offer_purchased(uuid, numeric, text, timestamptz) is
  'רדאר המדף: כפתור "קניתי" - סוגר הצעה, מסמן שאר ההצעות הפתוחות לאותו ספר כלא-רלוונטיות, ומעדכן books.status להשגתי - הכול בטרנזקציה אחת אטומית.';

revoke all on function public.mark_manual_offer_purchased(uuid, numeric, text, timestamptz) from public;
grant execute on function public.mark_manual_offer_purchased(uuid, numeric, text, timestamptz) to authenticated;
