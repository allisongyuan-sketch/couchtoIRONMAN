-- Repurpose — initial schema (PRD §27)
--
-- Not required to run the MVP: the app is local-first and works with no account
-- (PRD §26). This exists so that the shape of the data is settled before sync is
-- built, and so the local repositories have a target to map onto.
--
-- Two structural decisions carry the product's promises:
--   1. `exercises` (movements) are separate from `workout_exercises` (prescriptions),
--      so the movement catalog is reusable across workouts and creators.
--   2. `extractions` are kept alongside, never inside, workouts — user edits must
--      not destroy what the AI originally produced, and the diff between the two
--      IS the extraction edit rate we need to measure.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- users

create table users (
  id           uuid primary key default gen_random_uuid(),
  email        text unique,
  display_name text,
  plan         text not null default 'free' check (plan in ('free', 'pro')),
  created_at   timestamptz not null default now()
);

-- ------------------------------------------------------- source content
-- The original Reel/Short/TikTok. Immutable record of provenance, retained so that
-- "View Original" keeps working after conversion (PRD §33).

create table source_content (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references users(id) on delete cascade,
  platform       text not null check (platform in ('tiktok','instagram','youtube','upload','other')),
  url            text,
  creator_handle text,
  caption        text,
  thumbnail_url  text,
  source_title   text,
  created_at     timestamptz not null default now()
);

create index source_content_user_idx on source_content(user_id, created_at desc);
-- One row per piece of content per user: re-importing the same link reuses it.
create unique index source_content_url_idx on source_content(user_id, url) where url is not null;

-- ---------------------------------------------------------- extractions
-- One AI run over one piece of source content. Versioned and auditable.

create table extractions (
  id                 uuid primary key default gen_random_uuid(),
  source_content_id  uuid not null references source_content(id) on delete cascade,
  service_id         text not null,          -- 'mock' | 'llm:<model>'
  model_id           text,
  status             text not null check (status in ('succeeded','no_workout_detected','failed')),
  -- The raw structured result, exactly as produced, before any user edit.
  result             jsonb,
  -- What the guardrail pass stripped or flagged, and why. The evidence that the
  -- system extracted rather than invented (PRD §21).
  guardrail_actions  jsonb not null default '[]'::jsonb,
  detected_movements text[] not null default '{}',
  failure_reason     text,
  duration_ms        integer not null default 0,
  created_at         timestamptz not null default now()
);

create index extractions_source_idx on extractions(source_content_id, created_at desc);

-- ------------------------------------------------------------- workouts

create table workouts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references users(id) on delete cascade,
  source_content_id uuid references source_content(id) on delete set null,
  extraction_id     uuid references extractions(id) on delete set null,
  title             text not null,
  -- Summary label for display/filtering. `workout_blocks` is the executable truth.
  structure         text not null default 'unknown',
  workout_notes     jsonb not null default '[]'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  last_performed_at timestamptz
);

create index workouts_user_idx on workouts(user_id, updated_at desc);

-- --------------------------------------------------------------- blocks
-- A circuit is ONE block with rounds = 3, not three exercises that each claim
-- "3 sets". That distinction is load-bearing at execution time (PRD §22).

create table workout_blocks (
  id                           uuid primary key default gen_random_uuid(),
  workout_id                   uuid not null references workouts(id) on delete cascade,
  kind                         text not null check (kind in
                                 ('straight_sets','circuit','superset','interval','amrap','emom','flow')),
  label                        text,
  -- Provenance-carrying fields are jsonb ExtractedField documents, not bare numbers:
  -- "3 rounds, stated in speech, confidence 0.96" is not the same fact as "3".
  rounds                       jsonb,
  rest_between_rounds_seconds  jsonb,
  cap_seconds                  jsonb,
  position                     integer not null,
  unique (workout_id, position)
);

-- ------------------------------------------------------- exercise catalog
-- The movement itself. NOT owned by a workout (PRD §27) — this is what will later
-- carry demo media, muscle groups and shared cues.

create table exercises (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,     -- 'bulgarian-split-squat'
  display_name text not null,
  created_at   timestamptz not null default now()
);

-- ------------------------------------------------------ the prescription

create table workout_exercises (
  id               uuid primary key default gen_random_uuid(),
  block_id         uuid not null references workout_blocks(id) on delete cascade,
  exercise_id      uuid not null references exercises(id) on delete restrict,
  -- Every field below is an ExtractedField document: { value, source, confidence,
  -- needsReview, supersedes }. Storing provenance rather than bare values is what
  -- lets the UI distinguish "creator said 10" from "we think 10" from "unknown",
  -- and lets a user edit override a value without erasing what it replaced.
  name             jsonb not null,
  sets             jsonb,
  reps             jsonb,
  reps_per_side    jsonb,
  duration_seconds jsonb,
  rest_seconds     jsonb,
  weight           jsonb,
  resistance       jsonb,
  form_cues        jsonb not null default '[]'::jsonb,
  notes            jsonb not null default '[]'::jsonb,
  position         integer not null,
  unique (block_id, position)
);

create index workout_exercises_exercise_idx on workout_exercises(exercise_id);

-- -------------------------------------------------------------- sessions

create table workout_sessions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references users(id) on delete cascade,
  workout_id          uuid not null references workouts(id) on delete cascade,
  status              text not null check (status in ('not_started','active','completed','abandoned')),
  started_at          timestamptz not null default now(),
  ended_at            timestamptz,
  duration_seconds    integer,
  exercises_completed integer not null default 0,
  exercises_total     integer not null default 0
);

create index workout_sessions_user_idx on workout_sessions(user_id, started_at desc);
-- At most one workout in progress per user: resuming must be unambiguous (PRD §23).
create unique index workout_sessions_active_idx on workout_sessions(user_id)
  where status = 'active';

-- Per-step detail. Not shown in the MVP's History screen, but recording it now is
-- what makes volume, PRs and training analytics possible later without a migration.
create table workout_session_steps (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null references workout_sessions(id) on delete cascade,
  step_id             text not null,  -- the compiled plan's stable step id
  step_index          integer not null,
  kind                text not null check (kind in ('exercise_set','rest')),
  workout_exercise_id uuid references workout_exercises(id) on delete set null,
  outcome             text not null check (outcome in ('pending','completed','skipped')),
  elapsed_seconds     integer,
  completed_at        timestamptz,
  unique (session_id, step_id)
);

-- --------------------------------------------------------- row security
-- Everything a user creates is private to them. `exercises` is the one shared table:
-- the movement catalog is global by design, and contains no user data.

alter table users                 enable row level security;
alter table source_content        enable row level security;
alter table extractions           enable row level security;
alter table workouts              enable row level security;
alter table workout_blocks        enable row level security;
alter table workout_exercises     enable row level security;
alter table workout_sessions      enable row level security;
alter table workout_session_steps enable row level security;

create policy users_self on users
  for all using (id = auth.uid());

create policy source_content_owner on source_content
  for all using (user_id = auth.uid());

create policy workouts_owner on workouts
  for all using (user_id = auth.uid());

create policy sessions_owner on workout_sessions
  for all using (user_id = auth.uid());

-- Child tables inherit ownership through their parent rather than duplicating user_id,
-- which keeps a row from ever disagreeing with its parent about who owns it.
create policy extractions_owner on extractions
  for all using (exists (
    select 1 from source_content sc
    where sc.id = extractions.source_content_id and sc.user_id = auth.uid()
  ));

create policy blocks_owner on workout_blocks
  for all using (exists (
    select 1 from workouts w
    where w.id = workout_blocks.workout_id and w.user_id = auth.uid()
  ));

create policy workout_exercises_owner on workout_exercises
  for all using (exists (
    select 1 from workout_blocks b
    join workouts w on w.id = b.workout_id
    where b.id = workout_exercises.block_id and w.user_id = auth.uid()
  ));

create policy session_steps_owner on workout_session_steps
  for all using (exists (
    select 1 from workout_sessions s
    where s.id = workout_session_steps.session_id and s.user_id = auth.uid()
  ));
