-- Fix (2026-08-16, applied live). Same Vault pattern already used for
-- alerts_schedule_secret and gmail_app_password: store the render-server
-- credentials in Supabase Vault, expose them only through a SECURITY
-- DEFINER RPC restricted to service_role. The secret values themselves
-- (render_server_url, render_server_shared_secret) were created via
-- vault.create_secret() directly against production, not by this file -
-- migrations should not carry credential values.

create or replace function public.get_render_server_config()
returns table(render_url text, render_secret text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select decrypted_secret from vault.decrypted_secrets where name = 'render_server_url' limit 1),
    (select decrypted_secret from vault.decrypted_secrets where name = 'render_server_shared_secret' limit 1);
$$;

revoke all on function public.get_render_server_config() from public, anon, authenticated;
grant execute on function public.get_render_server_config() to service_role;

comment on function public.get_render_server_config() is
  'Retrieves the render-server base URL and shared secret from Vault. service_role only.';
