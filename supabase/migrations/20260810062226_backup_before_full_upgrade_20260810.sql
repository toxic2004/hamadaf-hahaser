-- Reconciliation note (added 2026-08-14, no re-run against production):
-- Applied directly to production on 2026-08-10, reproduced verbatim from
-- supabase_migrations.schema_migrations.statements. Do not re-apply.
--
-- IMPORTANT FOR FUTURE REFERENCE: this created a full snapshot of every
-- table (schema upgrade_backup_20260810) as of 2026-08-10, which is a
-- real, existing rollback point in production if ever needed. Note the
-- backup covers table rows only; Storage object bytes for book covers are
-- referenced by metadata only, not copied.

create schema if not exists upgrade_backup_20260810;

revoke all on schema upgrade_backup_20260810 from public, anon, authenticated;

create table if not exists upgrade_backup_20260810.books as
select * from public.books with data;

create table if not exists upgrade_backup_20260810.price_offers as
select * from public.price_offers with data;

create table if not exists upgrade_backup_20260810.price_history as
select * from public.price_history with data;

create table if not exists upgrade_backup_20260810.daily_book_prices as
select * from public.daily_book_prices with data;

create table if not exists upgrade_backup_20260810.notifications as
select * from public.notifications with data;

create table if not exists upgrade_backup_20260810.notification_settings as
select * from public.notification_settings with data;

create table if not exists upgrade_backup_20260810.price_scan_runs as
select * from public.price_scan_runs with data;

create table if not exists upgrade_backup_20260810.alerts_rate_limits as
select * from public.alerts_rate_limits with data;

create table if not exists upgrade_backup_20260810.storage_objects_metadata as
select id, bucket_id, name, owner, owner_id, created_at, updated_at,
       last_accessed_at, metadata, version
from storage.objects
where bucket_id = 'book-covers';

create table if not exists upgrade_backup_20260810.manifest (
  created_at timestamptz not null default now(),
  purpose text not null,
  notes text not null
);

insert into upgrade_backup_20260810.manifest (purpose, notes)
select
  'Pre-upgrade checkpoint for Hamadaf Hahaser',
  'Database rows and Storage metadata only. Storage object bytes are not copied by database backups.'
where not exists (select 1 from upgrade_backup_20260810.manifest);

revoke all on all tables in schema upgrade_backup_20260810 from public, anon, authenticated;
