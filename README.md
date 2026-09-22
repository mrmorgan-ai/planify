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
| Backlog | One phase at a time, one line per item: state, dates you can edit, resources. Expanding a row shows duration, description, outcome, skills, price and dependencies |
| Work items | The roadmap as units rather than dates — each course, book, project or exam with its parts, its phases and how far through it you are |
| Kanban | The active phase as a board, with the current week's available and scheduled hours, and items split into this week and later |
| Gantt | One phase at a time, by day: the plan under the projection, pauses shaded, dependencies on hover |

The backlog and the board write the same state. The dashboard, the work items
and the Gantt only reflect it. Links between views land on the row they point
at and highlight it.

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

- **Shape**: unique ids, curated order, links, timezone, phase numbering, item counts per phase.
- **Dates**: nothing starts or ends inside a pause, every item stays in its phase window, and no item spans more than seven study days.
- **Graph**: dependencies exist and form no cycle; every phase waits on the previous phase's closing milestone; each milestone waits on its whole phase; project tasks follow each other strictly.
- **Work items**: every item's work item exists, each has at least two parts, and parts never overlap.
- **Hours and outcomes**: every item has an hours estimate, no week is planned above its capacity, and practice and exam-preparation items state what done means.
- **Skills**: every skill belongs to a dimension, and every dimension is used.
- **The plan is born on time**: with nothing done, the engine projects every item exactly onto its planned dates.

## API

| Method | Path | Does |
|---|---|---|
| GET | `/api/state` | The whole roadmap with today's date |
| PATCH | `/api/items/:id/state` | Set `pending`, `in_progress` or `done`, and recompute |
| PATCH | `/api/items/:id/dates` | Move an item's planned dates, and recompute |
| PATCH | `/api/items/:id/hours` | Declare the hours spent so far, without changing the state |
| POST | `/api/reproject` | Recompute every projection |
| GET | `/api/health` | Liveness |

Every write returns the whole new state.

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
