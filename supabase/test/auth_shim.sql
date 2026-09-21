-- Minimal stand-in for the parts of Supabase's platform schema the migrations use.
--
-- Supabase provides an `auth` schema and an `auth.uid()` that reads the subject out
-- of the request's JWT claims. Neither exists in a bare Postgres, so the migrations
-- cannot be executed — and therefore cannot be *verified* — without this.
--
-- The definition below matches Supabase's own, so an RLS policy that passes here
-- behaves the same way against a hosted project.

create schema if not exists auth;

-- Note the nullif BEFORE the cast. With no session, `request.jwt.claims` is the
-- empty string, and casting that to json raises rather than returning null — which
-- would turn the signed-out case into an error instead of "sees nothing". Supabase's
-- own definition guards it the same way, and the signed-out path is the one that
-- matters most for a key that ships inside the app.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;

-- Supabase's own users live in auth.users; ours reference a public users table, so
-- this only has to exist for parity, not to be used.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);
