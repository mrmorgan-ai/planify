# Planify

A tracker for a long study roadmap. Items are grouped in phases, carry real
dependencies between them, and their dates are recalculated automatically when
something finishes early or late.

It draws the original plan and the live projection on the same bar, so the
question it answers is "am I ahead or behind today?" rather than "what were the
dates again?".

## What it does

- **Plans in phases and weeks.** Every item has a planned start and end, an hours
  estimate and the skills it covers. Weekly capacity is declared, so the app can
  say how full a week is.
- **Recalculates dates.** Marking an item done, or editing a planned date,
  recomputes every projection through the dependency graph. Declared pauses are
  skipped, so a bar that crosses one is cut at the pause and resumes after it.
- **Never blocks.** Dependencies move dates; they never stop you starting or
  finishing anything. Work done out of order is flagged, not refused.
- **Groups work into units.** Anything longer than a week is split into parts —
  a course by week, a book by chapter, a project by task — and the parts are
  grouped under a work item that shows the unit's progress as a whole.
- **States what done means.** An item can carry a checkable outcome ("the
  benchmark table is written and explained"), shown on the board where the work
  is picked up.
- **Tracks hours, not only ticks.** Hours spent can be declared on an item while
  it is still open, so progress moves with the work rather than only when
  something is finished.

## The five views

| View | What it is for |
|---|---|
| Dashboard | Today and what is in progress; hours done against the hours the plan expected by today, overdue items, next milestone and pace; a skills radar with its dimensions |
| Backlog | One phase at a time, one line per item: state, dates you can edit, resources. Moving an item's dates pushes everything that depends on it forward by the same study days. Expanding a row shows duration, description, outcome, skills, price and dependencies |
| Work items | The roadmap as units rather than dates — each course, book, project or exam with its parts, its phases and how far through it you are |
| Kanban | The active phase as a board, with the current week's available and scheduled hours, and items split into this week and later |
| Gantt | One phase at a time, by day: the plan under the projection, pauses shaded, dependencies on hover, and the button that reschedules the plan |

The backlog and the board write the same state. The dashboard, the work items
and the Gantt only reflect it. Links between views land on the row they point
at and highlight it.

When the oldest unfinished item is a week or more past its end, the app offers
to reschedule: a pop-up once a week, then a banner on every view. Rescheduling
picks a restart date and moves every unfinished item forward by the same study
days, so the earliest one starts that day and the plan keeps its shape. It
shows what moves before writing anything, and the plan it replaces is kept in
`plan_versions`.

## Stack

React and Vite for the web app, Cloudflare Pages Functions for the API, and
Cloudflare D1 (SQLite) for storage. The recalculation engine is plain
TypeScript with no platform dependencies, tested with fixtures.

## Layout

```
src/core/        types, civil dates, the recalculation engine, hours, work items, dashboard metrics
src/server/      database rows ↔ domain, and the read/write cycle
src/ui/          the React app
functions/api/   API routes, one file per endpoint
migrations/      database schema
tools/seed/      seed validator, seed → SQL, and database → seed
seed/            roadmap.example.json, the reference shape of a roadmap
```

`src/core/` is compiled both for the browser and for the Workers runtime, which
keeps it free of anything platform-specific.

## Running it locally

Requirements: Node 24 and npm.

```bash
npm install
cp seed/roadmap.example.json seed/roadmap.json    # start from the example roadmap
npm run seed:validate                             # check it against every rule
npm run seed:sql                                  # seed → build/seed.sql
npm run db:migrate:local                          # create the local database
npx wrangler d1 execute planify --local --file build/seed.sql
```

Then:

```bash
make start      # builds, migrates, starts the API on :8788 and the app on :5173
make stop
```

Open `http://127.0.0.1:5173`. `make start` refuses to start if a port is taken
and names what holds it. Both work on macOS and Linux.

To see the app with work behind schedule, `make start-overdue` moves the local
plan so it began on the Monday four weeks ago, starts the app if it is not
running, and recomputes the projections. Running it again gives the same dates.
It rewrites the local dates; to get the originals back, reload the seed and
reproject:

```bash
make start-overdue
node tools/seed/to-sql.mjs seed/roadmap.example.json --with-dates
npx wrangler d1 execute planify --local --file build/seed.sql
curl -X POST http://127.0.0.1:8788/api/reproject
```

## The roadmap file

A roadmap is one JSON file: its phases, declared pauses, weekly capacity, skill
map, work items and items. `seed/roadmap.example.json` shows every field in use.

The roadmap lives in the database. To change it as a file, download it from
**Settings**, edit it anywhere, and import it back there. Before anything is
saved, the preview lists what would be added, removed and edited, the progress a
removal would lose, and any rule the file breaks. A file exported before the
roadmap last changed is refused rather than undoing what changed since. Scripts
do the same through `GET /api/export` and `POST /api/import`.

The SQL loader is for the local database only — to set it up, or to reset it to
a seed:

```bash
npm run seed:validate                       # every rule, on every seed file present
npm run seed:sql                            # → build/seed.sql (an upsert)
node tools/seed/to-sql.mjs --with-dates     # same, also overwriting planned dates
npm run seed:export:local                   # local database → seed/roadmap.json
```

After loading a seed, `POST /api/reproject` recomputes the projections.

Loading is an upsert. Progress (state, completion dates, projections) is never
touched, and neither are planned dates unless `--with-dates` is passed, because
they can be edited in the app. Items and work items no longer in the file are
deleted.

### What the validator checks

`src/core/validate.ts` checks a whole roadmap at once and sorts what it finds
by severity, set per rule in its `RULES` table.

**Errors** — data the app cannot run on:

- **Ids**: kebab-case and unique; a work item never reuses an item id.
- **Phases**: numbered 1 to n without gaps; every item in a defined phase; each closing milestone exists inside its own phase; a unique curated order within each phase.
- **Settings**: a timezone the runtime knows; links are https or empty.
- **Dates**: at least one study day, ending on or after the start; never starting or ending inside a pause; never before the plan's start date.
- **Graph**: dependencies exist, are not the item itself, are not repeated, and form no cycle; every item's work item exists.
- **Skills**: every skill an item uses is on a radar axis that exists.

**Warnings** — the plan's own conventions:

- No item spans more than seven study days, and no week is planned above its capacity.
- Phases follow each other without overlapping (their windows are read off the items).
- Every phase waits on the previous phase's closing milestone, each milestone waits on its whole phase, and project tasks follow each other strictly.
- Every work item has at least two parts, and they never overlap.
- Every item has an hours estimate, and practice and exam-preparation items state what done means.
- Every mapped skill is used, and every radar axis has a skill.
- **The plan is born on time**: no dependency ends on or after the planned start of an item that waits on it — otherwise the engine shifts that item the moment the plan loads.

`npm run seed:validate` requires every seed file present to pass clean, warnings
included, and proves each rule fires by breaking a copy of the example seed.

## API

| Method | Path | Does |
|---|---|---|
| GET | `/api/state` | The whole roadmap with today's date |
| GET | `/api/export` | The roadmap as a seed file, content only, naming the revision it was taken from |
| POST | `/api/import` | Replace the roadmap's content with a seed file's, keeping progress; `dryRun` previews it |
| PATCH | `/api/items/:id/state` | Set `pending`, `in_progress` or `done`, and recompute |
| PATCH | `/api/items/:id/dates` | Move an item's planned dates, and recompute |
| PATCH | `/api/items/:id/hours` | Declare the hours spent so far, without changing the state |
| POST | `/api/reschedule` | Move every unfinished item so the plan restarts on a date, keeping the old plan |
| POST | `/api/reproject` | Recompute every projection |
| GET | `/api/health` | Liveness |

Every write returns the whole new state, and every write body carries the
`revision` of the state it was made from. A write made from an older revision is
refused with `409` and the current state, so a second device or tab catches up
instead of overwriting what the first one saved. The check runs again inside the
write's own transaction, so two writes racing from the same revision cannot both
land. `reproject` alone accepts no revision: it only recomputes from what is
stored, and scripts call it without a body.

A write that moves planned dates is checked against the validator before it
lands. One that would bring in an error the roadmap did not already have — an
item starting inside a pause, say — is refused with `422` and the errors it
would have introduced. Warnings never refuse a write.

An import sends `{ revision, roadmap }`: the file, and the revision it was
exported from, so a file edited while the app moved on is refused rather than
undoing what changed since. The file defines the content, planned dates
included; items it keeps keep their progress, new ones start pending, and items
it drops are deleted with theirs. With `dryRun: true` nothing is written and the
answer lists what would be added, removed (with the progress lost) and edited,
plus every issue the imported roadmap has.

## Checks

```bash
npm run typecheck
npm test
npm run build
```

Run them without a pipe: piping hides the exit code, and a failing check then
looks like a passing one.

## License

MIT — see [LICENSE](LICENSE).
