-- Real bug found (2026-08-17, applied live). The Findabook parser was
-- fully built and deployed (scanner-core.mjs, index.ts), but never
-- actually ran in a real scheduled cycle: sync_report_run_scope() only
-- creates report_checks rows for sources listed in
-- public.report_sources, and 'findabook' was never added there -
-- confirmed via a live scheduled run where 'findabook' was completely
-- absent from that run's report_checks, while every other source
-- (including the intentionally-blocked ones) appeared normally.

insert into public.report_sources (id, label, sort_order, active, check_mode)
values ('findabook', 'Findabook', 11, true, 'authorized_automation')
on conflict (id) do nothing;
