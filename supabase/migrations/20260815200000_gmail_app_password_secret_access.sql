-- Fix (2026-08-15, applied live). No tool was available in this
-- environment to set a Supabase Edge Function secret directly (the usual
-- `supabase secrets set GMAIL_APP_PASSWORD=...` path, or the dashboard
-- equivalent). Reused the exact same pattern already in production for
-- alerts_schedule_secret (see 20260721204848_alerts_schedule_security.sql):
-- store the credential in Supabase Vault, expose it only through a
-- SECURITY DEFINER RPC restricted to service_role.
--
-- The Vault secret itself (name: 'gmail_app_password') was created via
-- vault.create_secret() directly against production, not by this file -
-- migrations should not carry credential values. This file only creates
-- the read accessor function.

create or replace function public.get_gmail_app_password()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'gmail_app_password'
  limit 1;
$$;

revoke all on function public.get_gmail_app_password() from public, anon, authenticated;
grant execute on function public.get_gmail_app_password() to service_role;

comment on function public.get_gmail_app_password() is
  'Retrieves the Gmail SMTP App Password from Vault for report delivery. service_role only.';
