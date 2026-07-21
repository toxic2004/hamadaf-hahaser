-- הרשאות מצומצמות לפונקציית ההתראות הפנימית

grant select on table public.books to service_role;

grant select, insert, update on table
  public.price_offers,
  public.price_history,
  public.daily_book_prices,
  public.notifications,
  public.notification_settings,
  public.price_scan_runs
to service_role;
