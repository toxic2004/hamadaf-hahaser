-- רדאר המדף - קליטה מתמונה: גישה למפתח Anthropic API דרך Vault.
-- אותו דפוס בדיוק כמו get_gmail_app_password
-- (20260815200000_gmail_app_password_secret_access.sql): הסוד עצמו
-- (שם: 'anthropic_api_key') לא מוזן על ידי המיגרציה הזו - צריך להיווצר
-- בנפרד ב-Vault (vault.create_secret) לפני שהפונקציה תוכל להחזיר ערך
-- אמיתי. עד אז, radar-image-ingest תחזיר שגיאה ברורה
-- ("ANTHROPIC_API_KEY not configured") במקום ליפול בצורה לא צפויה.

create or replace function public.get_anthropic_api_key()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'anthropic_api_key'
  limit 1;
$$;

revoke all on function public.get_anthropic_api_key() from public, anon, authenticated;
grant execute on function public.get_anthropic_api_key() to service_role;

comment on function public.get_anthropic_api_key() is
  'Retrieves the Anthropic API key from Vault for radar-image-ingest (radar hamadaf). service_role only.';
