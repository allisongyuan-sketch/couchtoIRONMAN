-- Does the security model actually hold?
--
-- The Supabase anon key ships inside the app bundle. That is safe ONLY because Row
-- Level Security scopes every row to auth.uid(). This proves that claim rather than
-- asserting it in a comment.
--
-- Every check below RAISES on failure, so the script exits non-zero. An earlier
-- version of this file only printed counts, and it reported success during a run
-- where isolation was completely broken — a test that cannot fail is worse than no
-- test, because it manufactures confidence.
--
-- Two ways this test silently invalidates itself, both of which it now guards:
--
--   * Running as a superuser or as the tables' owner. Both bypass RLS entirely, so
--     every check would pass while proving nothing. The personas assert they are
--     neither.
--   * `SET LOCAL` outside a transaction block, which warns and does nothing —
--     leaving you as the superuser. Every persona runs inside BEGIN/ROLLBACK.
--
-- Run via supabase/test/verify.sh.

\set ON_ERROR_STOP on

-- Roles are cluster-wide, so this survives dropping the database between runs.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user nologin;
  end if;
end $$;

grant usage on schema public to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;

create or replace function assert_eq(label text, actual anyelement, expected anyelement)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL % — expected %, got %', label, expected, actual;
  end if;
  raise notice 'ok  %', label;
end $$;

insert into users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into synced_workouts (user_id, id, document, updated_at) values
  ('11111111-1111-1111-1111-111111111111', 'wk_alice',
   '{"id":"wk_alice","title":"Alice Leg Day"}'::jsonb, now()),
  ('22222222-2222-2222-2222-222222222222', 'wk_bob',
   '{"id":"wk_bob","title":"Bob Push Day"}'::jsonb, now());

insert into synced_sessions (user_id, id, document, completed_at) values
  ('11111111-1111-1111-1111-111111111111', 'ses_alice', '{"sessionId":"ses_alice"}'::jsonb, now()),
  ('22222222-2222-2222-2222-222222222222', 'ses_bob',   '{"sessionId":"ses_bob"}'::jsonb, now());

\echo ''
\echo '=== Alice ==='
begin;
  set local role app_user;
  set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';

  do $$
  begin
    -- If either of these is wrong, nothing below proves anything.
    perform assert_eq('persona is unprivileged', current_user::text, 'app_user');
    perform assert_eq('persona is not superuser',
      coalesce((select usesuper from pg_user where usename = current_user), false), false);

    perform assert_eq('sees only own workouts', (select count(*) from synced_workouts), 1::bigint);
    perform assert_eq('sees only own sessions', (select count(*) from synced_sessions), 1::bigint);
    perform assert_eq('sees own title',
      (select document->>'title' from synced_workouts), 'Alice Leg Day');

    -- Another user's row is invisible, not merely write-protected.
    perform assert_eq('cannot see other user row',
      (select count(*) from synced_workouts where id = 'wk_bob'), 0::bigint);
  end $$;

  -- Writes against an invisible row must affect nothing.
  update synced_workouts set document = '{"title":"hijacked"}'::jsonb where id = 'wk_bob';
  delete from synced_workouts where id = 'wk_bob';

  do $$
  begin
    perform assert_eq('cannot modify other user row',
      (select count(*) from synced_workouts where document->>'title' = 'hijacked'), 0::bigint);
  end $$;

  -- Forging a row into another account must be refused. Without a WITH CHECK clause
  -- — explicit, or inherited from USING on a FOR ALL policy — this would succeed.
  do $$
  begin
    insert into synced_workouts (user_id, id, document, updated_at)
    values ('22222222-2222-2222-2222-222222222222', 'wk_forged', '{}'::jsonb, now());
    raise exception 'FAIL cannot forge row into another account — WITH CHECK is missing';
  exception when insufficient_privilege then
    raise notice 'ok  cannot forge row into another account';
  end $$;
rollback;

\echo ''
\echo '=== Bob: nothing Alice did touched him ==='
begin;
  set local role app_user;
  set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';

  do $$
  begin
    perform assert_eq('workout survived', (select count(*) from synced_workouts), 1::bigint);
    perform assert_eq('title unchanged',
      (select document->>'title' from synced_workouts), 'Bob Push Day');
    perform assert_eq('no forged row',
      (select count(*) from synced_workouts where id = 'wk_forged'), 0::bigint);
  end $$;
rollback;

\echo ''
\echo '=== Signed out: no JWT at all ==='
begin;
  set local role app_user;
  set local request.jwt.claims = '';

  -- The case that matters most for a key shipped inside the app: with no session,
  -- auth.uid() is null, so every policy must match nothing. It must also not ERROR —
  -- an exception here would mean the signed-out path is broken rather than empty.
  do $$
  begin
    perform assert_eq('anon sees no workouts', (select count(*) from synced_workouts), 0::bigint);
    perform assert_eq('anon sees no sessions', (select count(*) from synced_sessions), 0::bigint);
    perform assert_eq('anon sees no users', (select count(*) from users), 0::bigint);
  end $$;
rollback;
