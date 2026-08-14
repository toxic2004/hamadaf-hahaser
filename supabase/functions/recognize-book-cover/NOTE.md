# Reconciliation note (added 2026-08-14)

This function is deployed and ACTIVE in production (version 1, `verify_jwt: true`,
deployed 2026-07-29) but had no source code anywhere in git before this commit.
`index.ts` below was retrieved read-only via the Supabase API and is reproduced
verbatim. This commit does not deploy or change anything in production - it only
makes the already-running code visible and recoverable.

Dependency note: this function calls the OpenAI API (`gpt-5-mini`, via
`OPENAI_API_KEY`) for cover image recognition. This is a paid external service
that was not previously documented as a project dependency anywhere in git.
