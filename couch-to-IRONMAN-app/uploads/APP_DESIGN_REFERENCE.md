# Couch to Ironman — App Structure & Design Reference

*A browser-based triathlon training companion. This document describes every screen, flow,
component, and styling convention in the current build, for use as a design reference.*

---

## 1. Product Summary

**Name:** Couch to Ironman
**Tagline:** "Sprint to Full Distance"
**One-line pitch:** A personalized training, tracking, and nutrition app that generates a
periodized triathlon plan for any race distance (Sprint, Olympic, 70.3, or Full Ironman) and
adapts to the athlete's real fitness level, schedule, and life.

**Design intent:** The app should feel like a purpose-built athletic instrument, not a generic
SaaS dashboard. Visual language draws from GPS watches, race-day data displays, and pre-dawn
training rather than corporate productivity software. It needs to work equally well for a
first-time athlete who has never done a triathlon and a competitive age-grouper — nothing
should read as intimidating or jargon-gated, but nothing should feel dumbed-down either.

**Platform:** Responsive web app (desktop sidebar layout, mobile pill-nav layout). Dark theme
only — no light mode currently exists.

---

## 2. Visual Design System

### 2.1 Color palette (CSS custom properties, defined in `:root`)

| Token | Hex | Usage |
|---|---|---|
| `--ink` | `#0b1220` | Page background (deep navy-black, "pre-dawn sky") |
| `--surface` | `#121b2e` | Card backgrounds |
| `--surface-raised` | `#182338` | Nested/inset elements (inputs, list rows, pills, inner cards) |
| `--hairline` | `#26324a` | All borders and dividers |
| `--text-primary` | `#edeff3` | Primary text (near-white) |
| `--text-secondary` | `#8e99ae` | Secondary/muted text, labels, captions |
| `--swim` | `#4fd1c5` | Swim discipline accent (teal) |
| `--bike` | `#f5a623` | Bike discipline accent (amber) — also the app's primary CTA color |
| `--run` | `#ff6b6b` | Run discipline accent (coral/red) |
| `--strength` | `#9f7aea` | Strength discipline accent (violet) |
| `--nutrition` | `#6ee7b7` | Nutrition-related accents (mint green) |

**Design signature:** each of the four training disciplines (swim/bike/run/strength) has a
dedicated, consistent color used everywhere that discipline appears — session badges, calendar
dots, phase-bar segments, sidebar progress ticks, chart bars. This is the core visual system
that ties the whole app together; a user should be able to identify "this is a swim thing" by
color alone before reading any text.

There is no light background anywhere in the app — even "raised" surfaces are still dark, just
one step lighter than the page background. Contrast comes from layering, not from switching to
white.

### 2.2 Typography

Loaded via Google Fonts `@import` in `index.css`:

- **Space Grotesk** (weights 500/600/700) — display face. Used for all headings (`h1`–`h4`) and
  anything with class `.font-display`. Slightly condensed letter-spacing (`-0.01em`). Geometric,
  technical character — deliberately not a generic humanist sans.
- **IBM Plex Sans** (weights 400/500/600) — body face. Default for all running text, labels,
  buttons, inputs.
- **IBM Plex Mono** (weights 400/500/600) — data face, applied via `.font-mono-data` class, with
  `font-variant-numeric: tabular-nums`. Used specifically for numeric/data readouts: week
  numbers, hour/session counts, RPE values, fueling calculator outputs, date numbers in the
  calendar grid. This is a deliberate signature: anywhere a number represents a real training
  metric (not just a count in prose), it renders in monospace, echoing a GPS watch or race
  computer display.

### 2.3 Shape, spacing, and elevation

- Border radius: consistently `rounded-lg` (0.5rem) to `rounded-xl` (0.75rem) — moderate
  rounding, never fully pill-shaped except for small badges/pills and the mobile nav.
- Cards (`Card` component): `rounded-xl`, `p-5` padding, 1px hairline border, `--surface`
  background. This is the base structural unit of nearly every screen.
- Nested/inset elements (inputs, list rows inside cards, session rows): `--surface-raised`
  background, no border, `rounded-lg`.
- No drop shadows anywhere — elevation is communicated purely through background layering
  (`ink` → `surface` → `surface-raised`) and hairline borders, not shadow/blur.
- Primary buttons use a diagonal gradient from `--run` to `--bike` (coral → amber, 135deg) with
  dark ink-colored text, a small `translateY(-1px)` lift and opacity fade on hover. This gradient
  is the one "warm" accent moment in an otherwise cool, dark palette — reserved for primary calls
  to action only.
- Secondary buttons: `--surface-raised` background, hairline border, border brightens to
  `--bike` on hover.
- Ghost buttons: text-only, `--text-secondary` → `--text-primary` on hover.
- Focus states: visible 2px `--bike`-colored outline on all interactive elements
  (`:focus-visible`), respecting keyboard navigation.
- Reduced motion is respected globally (`prefers-reduced-motion` collapses all animation/transition
  durations to near-zero).
- Custom scrollbar styling (10px, hairline-colored thumb) rather than default browser scrollbars.

### 2.4 Iconography

No icon library is used. Navigation icons are single Unicode glyphs (◈ ▦ ▤ ✎ ◆ ● ⚑) rendered at
text size — a deliberate minimal, typographic approach rather than a bundled icon set.

---

## 3. Information Architecture / Navigation

**Layout shell:** persistent left sidebar (desktop, `md:` breakpoint and up) or a horizontal
scrolling pill-nav bar (mobile, sticky to top). Main content area is capped at `max-w-5xl`,
centered, with generous padding.

**Sidebar contents (top to bottom):**
1. Brand lockup: "Couch to Ironman" (display font, semibold) + "Sprint to Full Distance" tagline
   (small, muted)
2. Primary navigation (7 items, in order):
   - **Dashboard** (◈) — `/`
   - **Calendar** (▦) — `/calendar`
   - **Training Plan** (▤) — `/plan`
   - **Log a Workout** (✎) — `/log`
   - **Strength** (◆) — `/strength`
   - **Nutrition** (●) — `/nutrition`
   - **Race-Day Rules** (⚑) — `/rules`
3. **Week Progress widget** (bottom of sidebar, persistent) — see §5.9

Active nav item: `--surface-raised` background pill, `--text-primary` text. Inactive:
transparent, `--text-secondary` text.

**Onboarding** (`/onboarding`) is a separate full-bleed route, outside the sidebar layout
entirely (no nav chrome) — it's a focused, linear flow.

---

## 4. Data Model (conceptual, for reference)

Everything persists to browser `localStorage` (schema-versioned key, currently v3). No backend
or accounts in the current build — this is a client-only, single-user app per browser.

- **profile** — race distance, race name/date, goal, fitness baselines, training days,
  hours/week, injury notes, computed experience level, computed weeks-until-race
- **plan** — an array of week objects, each containing a phase, focus text, hours target, the
  athlete's training days, and an array of session objects
- **session** — the atomic unit of the whole app: discipline, title, duration, target RPE,
  intensity label, description, day-of-week, a structured `sets` breakdown, completion state,
  actual duration/RPE, location, and free-text notes (full field list in §6)
- **logs** — a flat history of every workout logged via the Log page (independent of the plan,
  used for the all-time workout list)
- **strengthLogs** — strength session history
- **nutritionLogs** — training-day nutrition entries
- **fuelingProfile** — the athlete's saved race-day fueling plan inputs/outputs

---

## 5. Screens & Flows (in detail)

### 5.1 Onboarding (`/onboarding`)

A 4-step linear wizard inside a single centered `Card` (max-width ~2xl), no sidebar. A thin
2-color progress bar (4 equal segments, filled = `--bike`, unfilled = `--hairline`) sits above
the card and fills in as the user advances.

**Step 1 — "Race"**
- **Race distance picker**: a 2x2 grid of tappable cards, one per distance (Sprint / Olympic /
  IRONMAN 70.3 / Full IRONMAN 140.6). Each shows the distance label plus its swim/bike/run
  distances in small text (e.g. "1.2 mi (1.9km) swim · 56 mi bike · 13.1 mi (half marathon)
  run"). Selected state: `--bike` background, dark text. This is the first and most important
  decision in the whole flow — it re-contextualizes every question that follows.
- Race name (optional free text)
- Race date (native date picker) — changing the distance auto-updates the date field to a
  sensible default (today + that distance's default plan length)
- Goal selector (3 options): "Cross the finish line, feel good doing it" / "Build real fitness
  and enjoy the process" / "Race for a specific time or placement"
- Live helper text: "[X] weeks away. A [Distance] plan typically runs [min]-[max] weeks," with a
  warning line if the timeline is compressed for that distance

**Step 2 — "Fitness"**
- A small pill/banner reminding the user which distance they selected and its target distances
- Prior experience selector, phrased relative to the *target* distance: "Never raced a
  triathlon" / "Raced a shorter triathlon distance, but not this one" / "Raced this distance or
  longer before"
- Three paired free-entry fields (distance + optional time), one row each:
  - Longest continuous swim (meters) + time for that swim (minutes, optional)
  - Longest recent ride (miles) + time for that ride (minutes)
  - Longest recent run (miles) + time for that run (minutes)
  - *(All of these are plain number inputs — no sliders. This was a deliberate change from an
    earlier slider-based version, so users can enter precise, real numbers.)*
- Pool access selector: "Yes, regularly" / "Sometimes / limited access" / "No pool access right
  now"
- Conditional warning banner (amber/`--run`-tinted): appears only if the athlete's stated
  baselines fall under that distance's minimum pre-plan benchmark, explaining the plan will
  include extra base-building

**Step 3 — "Availability"**
- **Training day picker**: 7 tappable day-abbreviation buttons (Mon–Sun) in a single row,
  multi-select toggle. Selected = `--bike` fill. Live caption below: "[N] training days, [N] rest
  days per week."
- Hours available per week: slider, range 3–25
- Injury/limitation free-text textarea (optional)

**Step 4 — "Review"**
- A 2x2 grid of summary stat tiles (`--surface-raised` background, mono-data value): Race
  distance, Experience level (computed), Plan length in weeks, Training days/week
- "Generate my plan" primary button — this is the terminal action that computes the full plan
  and routes to the Dashboard

Navigation: "Back" (ghost button, hidden on step 1) and "Continue"/"Generate my plan" (primary
gradient button) at the bottom of every step. "Continue" is disabled on step 3 if zero training
days are selected.

### 5.2 Dashboard (`/`)

The home screen. If no profile/plan exists yet, shows a short welcome message ("Whether you're
working toward your first Sprint or your first Full Ironman...") and a single "Build my training
plan" CTA linking to onboarding — no nav-less empty state, sidebar is still present.

Once a plan exists:
- **Header row**: "Week [N] · [Phase] phase" (display font) + "[N] weeks to [race name or
  distance] race day" subtitle. Right-aligned: "Calendar" and "Full plan →" secondary buttons.
- **Phase progress bar** (`PhaseBar` component, in a Card) — see §5.10
- **3-stat row** (equal-width Cards):
  1. "This week's sessions completed" — e.g. "3/6" mono-data
  2. "Hours trained this week" — actual hours (summed from completed sessions' actual-or-planned
     duration) formatted as "X.X / Y.Yh target" — this is the stat that reflects custom-logged
     workouts
  3. "Total workouts logged" — count from the all-time log history
- **"Planned volume by week (hours)" bar chart** (Recharts `BarChart`) — one bar per week of the
  entire plan, height = that week's target hours, bars colored `--bike`, dark-themed
  grid/axes/tooltip matching the app's palette
- **"Logged session duration trend" line chart** — only appears once 2+ workouts have been
  logged; last 14 logged entries, x-axis = date, y-axis = duration in minutes, line colored
  `--run`
- **"This week's sessions" list** — every session in the current week, sorted by day-of-week,
  each preceded by a small day-name label (Mon/Tue/...), rendered as `SessionCard` components
  (see §6)

### 5.3 Calendar (`/calendar`)

A three-mode calendar (Month / Week / Day), toggled via a segmented control (pill group,
selected = `--bike` fill) in the header next to the page title.

All three modes read from a single computed array of "calendar days," each mapped from the
plan's week/day-of-week structure onto real dates, working backward from the race date so the
taper phase always lands on the correct calendar week.

- **Month view**: standard 6-row x 7-column grid (Mon–Sun headers), Prev/Next month navigation.
  Each day cell shows the date number (mono-data) and up to 4 small colored dots (one per
  session that day, colored by discipline) — no dot = rest day. Days outside the current month
  are dimmed (35% opacity). Today is outlined in `--bike`. Clicking any day jumps to Day view for
  that date. A discipline color legend sits below the grid.
- **Week view**: 7 equal-width Cards in a row (stacks on mobile), one per day, each showing the
  day abbreviation + date number (clicking jumps to Day view) and a compact list of that day's
  session titles (small colored dot + truncated title, strikethrough + dimmed if completed), or
  "Rest" if none. Prev/Next week navigation, header shows "Week [N] · [Phase]."
- **Day view**: single-column, max-width constrained. Prev/Next day navigation. Header shows full
  day name, formatted date, "· Today" if applicable, and "· Week [N] · [Phase]." Below: either a
  "Rest day" message Card, or a stacked list of full `SessionCard` components for that day
  (fully interactive — same expand/edit behavior as everywhere else).

### 5.4 Training Plan (`/plan`)

The full, linear week-by-week plan (as opposed to the Calendar's date-based view). Subtitle
states distance, total weeks, phase structure, hours/week, training days, and experience level,
with an inline link to the Calendar for "day-by-day" viewing.

A `PhaseBar` sits at the top (same component as Dashboard, scrubbing to show `expandedWeek` as
the "current" position).

Below: one collapsible Card per week (accordion behavior, only one open at a time by default,
starts with Week 1 expanded):
- Collapsed header row: "Week [N] · [Phase]" + optional "recovery" pill (teal-tinted) or "race
  week" pill (coral-tinted) + "[hours]h target · [completed]/[total] logged complete" + a
  +/− expand indicator
- Expanded body: italic phase-focus description sentence, then **every day of the week (Mon
  through Sun, always all 7 shown)** with a day-name label; days with sessions show stacked
  `SessionCard`s, empty days show a muted "Rest" pill.

### 5.5 Log a Workout (`/log`)

Purpose: let the athlete log any workout — either as an addition to what was planned, or as a
replacement for a specific planned session — and have it flow directly into the plan/calendar
and weekly totals.

- Intro copy explains the dual purpose ("Did something extra, or want to swap out today's
  planned session...")
- **Discipline selector**: 3-way segmented control (Swim / Bike / Run — no Strength here;
  strength has its own dedicated logging on the Strength page), selected = that discipline's
  accent color fill
- Form fields:
  - Date (native date picker, defaults to today) — changing this recalculates which planned
    sessions (if any) exist that day
  - Workout name (optional free text, placeholder e.g. "Easy shakeout swim")
  - **"How should this fit into your plan?"** — only shown if a plan exists:
    - Two-button toggle: "Add as extra" vs. "Replace a planned workout" (the replace button is
      disabled/dimmed if there are zero planned sessions that day)
    - If "Replace" is selected and sessions exist: a dropdown listing that day's planned
      sessions by title/duration/discipline to choose which one to swap out
    - If zero planned sessions exist that day: a muted note that it'll just be logged as extra
  - Duration (min, required), Distance (contextual unit hint: meters for swim, mi/km for
    bike/run), Pace (free text, e.g. "1:45/100m"), Avg heart rate (bpm)
  - Avg power (watts) — bike only, conditionally shown
  - Perceived effort (RPE) slider, 1–10, live label
  - Trail/route/pool location free-text field + inline `LocationMap` preview (see §7)
  - Notes free-text textarea
  - "Save workout" primary button (disabled if Replace mode is selected but no target session
    has been chosen yet)
- **Confirmation banner** after saving (mint/`--nutrition`-tinted), phrased differently depending
  on outcome:
  - Added/replaced successfully → "...check the Calendar."
  - Date outside the current plan's range → explicitly says it was NOT added to the Calendar,
    only to history
- **"Recent workouts" list** below the form — every entry ever logged via this page (all-time,
  not scoped to a date range), each a Card row with discipline dot, discipline+duration, date,
  distance/pace/location if present, and a "Delete" text-button

### 5.6 Strength (`/strength`)

- Intro copy: "Two 30-minute sessions a week, built around core, glutes, and shoulders..."
- **Focus selector**: 2-way toggle ("Core & Glutes" vs. "Shoulders & Mobility"), selected state
  fills with that focus's discipline color (violet for core, teal for shoulders — reusing swim's
  color since shoulder strength is framed as swim-supporting)
- Info Card: one-sentence "why this matters" explanation, then a list of exercises as rows, each
  showing exercise name + prescription (sets x reps, e.g. "Plank · 3 x 45s") and a right-aligned
  "Form help ↗" text link that opens a YouTube search for "[exercise name] proper form
  technique" in a new tab
- **"Log this session" Card**: duration (min) input + RPE slider (1–10), "Log session" button
- General **WorkoutHelpSearch** widget (see §7) for the whole strength focus area
- **History list**: past strength sessions logged, each showing focus label, duration, date

### 5.7 Nutrition (`/nutrition`)

Intro: "The fourth discipline" framing — most athletes blow up on the run because they
under-fueled the bike, not because they under-trained the run.

Two-tab interface (segmented control, selected = mint/`--nutrition` fill):

**Tab A — "Race-Day Fueling Planner"** (default tab)
- Inputs Card:
  - Build/athlete size selector: Smaller frame / Average / Larger-more muscular (scales carb and
    fluid targets within research-based ranges)
  - Expected bike time (hours) and expected run time (hours) — defaults pre-filled from the
    athlete's selected race distance's typical finishing times
  - Editable list of the athlete's own fueling products (name + carbs-per-serving grams), used
    to generate product suggestions in the schedule
  - "Generate my fueling plan" button
- Once generated, three result Cards appear:
  1. **Targets** — two side-by-side tiles (Bike / Run), each showing carbs/hour (large mono-data
     number), calories/hour, and fluid oz/hour, color-coded left border (bike accent / run
     accent). Below: a transition-note callout explaining the taper-to-water-only final 10
     minutes of the bike and the 5–10 minute delay before resuming fuel on the run.
  2. **Bike schedule** — a generated minute-by-minute table (every ~20 minutes): minute mark,
     grams of carb, oz of fluid, and a suggested product name (closest match from the athlete's
     entered products), all in mono-data font
  3. **Run schedule** — same structure, run-specific numbers

**Tab B — "Training Nutrition Log"**
- Form: carbs consumed (g), fluid consumed (oz), context selector (Training session / Brick
  session / Race day), notes textarea, "Log nutrition entry" button
- List of past entries below (carbs/fluid/context/date)

### 5.8 Race-Day Rules (`/rules`)

A read-only reference page, distance-aware (pulls the athlete's selected distance from their
profile).

- Intro states the athlete's specific distance and its swim/bike/run distances, with a caveat
  that rules/cut-offs vary by race organizer and to check the official athlete guide
- **Cut-off times Card**: for 70.3 and Full distances, a 3-tile row (Swim / Swim+Bike or
  Swim+T1+Bike / Total race) with large mono-data time values. For Sprint/Olympic (which don't
  have standardized IRONMAN-brand cut-offs), a plain-text note instead of tiles.
- **"Rules every age-grouper should know" Card**: 3 fixed rule entries (draft zone, helmet
  timing, on-course conduct), each a title + explanation row
- **"Official source" Card**: a single outbound link to the real IRONMAN competition rules page

---

## 6. The Session Object & `SessionCard` (the core recurring UI unit)

Nearly every screen (Dashboard, Calendar Day/Week/Month, Plan, and indirectly Log a Workout)
ultimately renders the same underlying unit: a **session**, using the same `SessionCard`
component. Understanding this one component thoroughly covers most of the app's interactive
surface.

**Collapsed state** (default): a single row —
- Checkbox (left, colored to match the discipline) toggling completion
- Title (strikethrough + 60% opacity once completed) + "[duration] min · RPE [target] target"
  caption below it
- Right-aligned discipline badge pill (capitalized discipline name, dark background, text colored
  to match discipline)

**Expanded state** (click anywhere on the row to toggle, checkbox click doesn't trigger expand):
- Italic one-line description of the session's purpose
- **Structured sets breakdown** — a bordered list of labeled rows (e.g. "Warm-up," "Main set,"
  "Drill set," "Cool-down," or for strength, individual exercise names), each with a small
  pill-badge label (mono-data, discipline-colored) and a detail sentence. This is real,
  specific prescribed content — e.g. "6 x 75m @ moderate effort, 20s rest," "4 x 6 min @
  threshold (RPE 7), 3 min easy spin recovery between," "25 min Zone 2 steady, then last 11 min
  at goal race pace" — not vague intensity labels. See §8 for the full generation logic.
- Two-column row: "Actual duration (min)" number input (placeholder = planned duration) and
  "Actual RPE" slider (1–10, defaults to target RPE if untouched)
- For swim/bike/run only: "Trail / route / pool location" text field + inline `LocationMap`
  embed that appears once a location is typed (see §7)
- "Notes / comments" textarea
- `WorkoutHelpSearch` widget at the bottom (see §7)

Every field in the expanded view is live-editable and writes immediately back into the plan's
stored state (no explicit "save" step within the card).

**Full session field list:** discipline, title, durationMin, targetRPE, intensity, description,
dayOfWeek, phase, sets[], completed, actualDurationMin, actualRPE, location, notes, plus
internal flags (isLongRide, isBrickRun, isBrickRidePaired, isCustom) used by the generation
engine but not directly shown in the UI.

---

## 7. Small Reusable Components

- **`Card`** — the universal container: rounded-xl, hairline border, `--surface` background,
  `p-5` padding. Accepts a custom `as` element and style overrides. Used everywhere.
- **`PhaseBar`** — a horizontal segmented bar, one slice per week in the plan, width = 100/total%,
  colored by that week's phase (Base=teal/swim, Build=amber/bike, Peak=coral/run,
  Taper=violet/strength), full opacity up through the "current" week and 25% opacity beyond it.
  A 4-item legend (colored dot + phase name) sits below. This is a signature visual element
  reused on both the Dashboard and the full Plan page.
- **`LocationMap`** — renders nothing if no location string is set; otherwise an inline
  `<iframe>` embedding a keyless Google Maps search (`google.com/maps?q=...&output=embed`), CSS
  color-inverted (`filter: invert(0.92) hue-rotate(180deg)`) so the normally-white map background
  matches the app's dark theme. No API key involved or required.
- **`WorkoutHelpSearch`** — a small dashed-border utility box: a text input pre-filled with a
  contextual default query (e.g. "Long Run run triathlon training how to"), editable by the
  user, with two buttons ("Search Google" / "Search YouTube") that open that query in a new tab.
  Appears at the bottom of every `SessionCard` and on the Strength page. This is a deliberately
  simple, keyless "help" affordance — no AI/API calls, just smart query pre-filling.

---

## 8. Plan Generation Logic (for context, not a screen)

Not a UI element itself, but shapes everything the UI displays, so worth summarizing for design
purposes:

- Plans always follow four phases in fixed proportion: **Base** (45% of weeks) → **Build** (30%)
  → **Peak** (15%) → **Taper** (10%).
- Every 4th week within Base/Build is a lighter "recovery" week (70% volume); the final week of
  Taper is a much lighter "race week" (35% volume).
- Every session's baseline duration scales off the athlete's chosen race distance (a Sprint's
  long ride ≈ 45 min at baseline; a Full Ironman's ≈ 5 hours), then further scales by the
  volume multiplier for that week's phase/position.
- Sessions are assigned to specific real days of the week based on the athlete's selected
  training days, with the long ride and brick run deliberately paired on the same (typically
  last-available) day.
- Each session gets a structured `sets` breakdown generated deterministically from its
  discipline, title, phase, and duration (e.g., swim technique sessions always get a warm-up +
  drill set + main set + cool-down structure; threshold bike rides get phase-appropriate
  interval prescriptions).

---

## 9. Tone of Voice (for any copy Claude Design generates)

- Encouraging, plain-spoken, never clinical or jargon-first. Terms like "Zone 2," "brick," "RPE"
  are used but explained in context rather than assumed.
- Second person, active voice, short sentences.
- Empty/rest states are framed positively ("Rest day. No sessions planned — recovery is part of
  the plan too," not just "No data").
- Warnings (e.g., compressed timeline, under-benchmark fitness) are informative and reassuring
  rather than alarming — always paired with what the app is already doing to handle it.
- No mascot, no forced humor in the UI copy itself (loading states elsewhere in the broader
  Claude ecosystem may be playful, but this app's own copy stays grounded and practical, matching
  a sports-science, GPS-watch aesthetic rather than a lifestyle-app one).
