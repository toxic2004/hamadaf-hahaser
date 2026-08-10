create index if not exists report_checks_source_id_idx
  on public.report_checks (source_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'upgrade_backup_20260810.books'::regclass
      and contype = 'p'
  ) then
    alter table upgrade_backup_20260810.books add primary key (id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'upgrade_backup_20260810.price_offers'::regclass
      and contype = 'p'
  ) then
    alter table upgrade_backup_20260810.price_offers add primary key (id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'upgrade_backup_20260810.price_history'::regclass
      and contype = 'p'
  ) then
    alter table upgrade_backup_20260810.price_history add primary key (id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'upgrade_backup_20260810.daily_book_prices'::regclass
      and contype = 'p'
  ) then
    alter table upgrade_backup_20260810.daily_book_prices add primary key (id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'upgrade_backup_20260810.notifications'::regclass
      and contype = 'p'
  ) then
    alter table upgrade_backup_20260810.notifications add primary key (id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'upgrade_backup_20260810.notification_settings'::regclass
      and contype = 'p'
  ) then
    alter table upgrade_backup_20260810.notification_settings
      add primary key (user_id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'upgrade_backup_20260810.price_scan_runs'::regclass
      and contype = 'p'
  ) then
    alter table upgrade_backup_20260810.price_scan_runs add primary key (id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'upgrade_backup_20260810.alerts_rate_limits'::regclass
      and contype = 'p'
  ) then
    alter table upgrade_backup_20260810.alerts_rate_limits
      add primary key (scope);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'upgrade_backup_20260810.storage_objects_metadata'::regclass
      and contype = 'p'
  ) then
    alter table upgrade_backup_20260810.storage_objects_metadata
      add primary key (id);
  end if;
end
$$;

alter table upgrade_backup_20260810.manifest
  add column if not exists id bigint generated always as identity;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'upgrade_backup_20260810.manifest'::regclass
      and contype = 'p'
  ) then
    alter table upgrade_backup_20260810.manifest add primary key (id);
  end if;
end
$$;
