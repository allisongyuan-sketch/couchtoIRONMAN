# Setting up Supabase

Accounts and sync are optional — without them the app is fully usable and entirely
local. This is what to do when you want them on.

Creating the project needs a browser and your own Supabase account, so those steps are
yours. Everything after is copy-paste.

---

## 1. Create the project

1. <https://supabase.com/dashboard> → **New project**.
2. Name it, choose a region close to your users, save the database password.
3. Wait for provisioning (~2 minutes).

## 2. Apply the migrations

Project → **SQL Editor** → paste and run, in order:

1. `supabase/migrations/0001_init.sql`
2. `supabase/migrations/0002_sync.sql`

Do **not** run `supabase/test/auth_shim.sql` — it is a local stand-in for the `auth`
schema that Supabase already provides. Running it against a real project would
shadow the real `auth.uid()`.

Or, with the CLI:

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

## 3. Allow the sign-in link to come back to the app

Email sign-in sends a one-time link, and Supabase will only redirect to a URL you have
allowed.

Project → **Authentication → URL Configuration → Redirect URLs**, add:

```
repurpose://auth-callback
```

That string must match `emailRedirectTo` in `src/state/container.ts`. If it doesn't,
sign-in silently fails at the last step, which is a miserable thing to debug.

## 4. Point the app at it

Project → **Settings → API**, then set:

```bash
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

Use the **anon / public** key, never the **service_role** key. The anon key is
designed to ship in clients and authorises nothing by itself; `service_role` bypasses
Row Level Security entirely and would hand every user's data to anyone with the app
binary.

Restart the bundler after changing these — `EXPO_PUBLIC_` variables are inlined at
build time, not read at runtime.

## 5. Check it worked

In the app: **Profile → Email me a sign-in link**, follow the link, and the screen
should show your email with a sync summary underneath.

Then confirm sync both ways:

1. Import or create a workout **before** signing in.
2. Sign in. It should upload — Profile shows `1 up`.
3. Project → **Table Editor → synced_workouts**: one row, `document` holding the
   whole workout with its provenance intact.

To check the download direction, sign in on a second device (or clear app storage and
sign in again). The library should repopulate.

---

## Verifying the schema without a project

The schema and its RLS policies are checked on every push by the `schema` CI job, and
you can run the same thing locally against any Postgres:

```bash
supabase/test/verify.sh
```

It applies both migrations, asserts RLS is enabled on every table holding user data,
then acts as two signed-in users and a signed-out one to prove none of them can reach
another's rows. It exits non-zero on failure — confirmed by sabotaging a policy and
watching it fail, because a test that cannot fail is worse than no test.

---

## Why the anon key is safe to ship, and what that depends on

Unlike the Anthropic and Deepgram keys — which are server-only, because a key in an
app bundle can be pulled out of the binary — the Supabase anon key is *designed* for
clients. It identifies the project and grants nothing on its own.

**That safety is conditional.** It holds only because every table containing user data
has RLS enabled with policies scoped to `auth.uid()`. Disable RLS on one table and
that key becomes a public read/write credential for it.

So if you add a table holding user data: enable RLS, add an owner policy, and let
`supabase/test/verify.sh` confirm it. The job fails on any unprotected table, which is
the point.
