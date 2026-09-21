-- Sync storage (Milestone 6)
--
-- The tables in 0001 model workouts relationally, for the server-side querying that
-- will eventually matter: which movements recur, what a creator's workouts have in
-- common, training analytics.
--
-- None of that is needed to stop someone losing their workouts when they change
-- phones, which is all sync has to do today. Shredding a nested document into five
-- tables and reassembling it is a lot of code with a lot of places to quietly drop a
-- field — provenance especially — for no benefit the MVP collects.
--
-- So sync stores the document, and the relational tables become a projection to build
-- when something actually reads them. The document is the source of truth either way,
-- which is what makes adding that projection safe later.

create table synced_workouts (
  user_id    uuid not null references users(id) on delete cascade,
  -- The client-generated workout id. Ids are unique per device and never collide,
  -- which is what lets sync merge by union rather than by guesswork.
  id         text not null,
  document   jsonb not null,
  -- Mirrors document->>'updatedAt'. Stored as a column so last-write-wins can be
  -- resolved without parsing every document.
  updated_at timestamptz not null,
  synced_at  timestamptz not null default now(),
  primary key (user_id, id)
);

create index synced_workouts_user_idx on synced_workouts(user_id, updated_at desc);

create table synced_sessions (
  user_id      uuid not null references users(id) on delete cascade,
  id           text not null,
  document     jsonb not null,
  completed_at timestamptz not null,
  synced_at    timestamptz not null default now(),
  primary key (user_id, id)
);

create index synced_sessions_user_idx on synced_sessions(user_id, completed_at desc);

-- Row Level Security is not optional here.
--
-- The anon key ships inside the app bundle, which is by design — it identifies the
-- project and authorises nothing on its own. What keeps it safe is that every row is
-- scoped to auth.uid(). Disabling RLS on either table would turn that key into a
-- public read/write credential for everyone's workouts.
alter table synced_workouts enable row level security;
alter table synced_sessions enable row level security;

create policy synced_workouts_owner on synced_workouts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy synced_sessions_owner on synced_sessions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
