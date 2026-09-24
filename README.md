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
- **Generates and places whole units.** A course, a certification, a project or
  a run of practice blocks is described in a few answers and added at once,
  placed in the hours the weekly capacity leaves free.
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
picks the week the plan restarts in and moves every unfinished item forward by
whole weeks, so the earliest unfinished week becomes that week. Each item keeps
its weekday and each week keeps its load: moving by a few days would leave
every calendar week holding pieces of two planned ones, over capacity. It shows
what moves before writing anything, and the plan it replaces is kept in the
history.

## Stack

React and Vite for the web app, Cloudflare Pages Functions for the API, and
Cloudflare D1 (SQLite) for storage. The recalculation engine is plain
TypeScript with no platform dependencies, tested with fixtures.

## Layout

```
src/core/        types, civil dates, the recalculation engine, hours, work items, dashboard metrics
src/server/      database rows ↔ domain, the read/write cycle, and who reaches which roadmap
src/ui/          the React app
functions/api/   API routes, one file per endpoint
migrations/      database schema
tools/seed/      seed validator, seed → SQL, and database → seed
tools/roadmaps/  roadmaps and their members
seed/            roadmap.example.json, the reference shape of a roadmap
templates/       starter.json, what a new person's roadmap begins as
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
**Settings** — it is named for when it was taken, `roadmap-2026-09-23-1332.json`
— edit it anywhere, and import it back there. Before anything is
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

## History

Every change to the plan keeps the plan it replaced: an edit, an import, a date
moved, a reschedule, a restore, a generation, a published draft. **Settings →
History** lists them newest first, each with a line saying what the change did.
Any of them can be brought back, after the same preview an import shows.

Progress is not a change of plan. Ticking an item off or logging hours keeps
nothing, and restoring a version keeps what has been done. Edits less than ten
minutes after the one before count as one change, so a form saved section by
section is one version, not five. The history keeps the last 50.

## Drafts

**Start a draft** in the header to change the plan without changing the live
roadmap. Every view then shows the draft — the backlog, the work items, the
Gantt, the settings and the warnings — and every edit, date moved or generator
run lands in it. Progress is always the live roadmap's: ticking an item off or
logging hours is done there, and the draft shows it as it happens.

A draft may break a rule the live roadmap refuses, since staging a change often
means passing through a state that breaks one. **Review and publish** shows
what it would change on the live roadmap, the same way an import does, and
refuses a draft that brings in an error. Publishing is one change: the live
roadmap's progress stays, the plan it replaces is kept in the history, and the
draft ends. The review also says when the live plan changed after the draft
started, since publishing replaces those changes.

There is one draft at a time, kept on the server, so it can be opened from any
device. **Back to live** leaves it as it is; **Discard** drops it.

## Generating items

**Backlog → Generate** adds a whole unit at once instead of one item at a time:

| Kind | Asks for | Makes |
|---|---|---|
| Course | Total hours and the most a week | A part a week, each holding what the week has free up to that pace |
| Certification | Prep hours and pace, exam hours, an optional exam day | Prep parts by the week, then the exam |
| Project | Tasks, one a line with their hours | The tasks in a chain, each in the first week with room |
| Practice | Hours a block and how many weeks | One block a week, at the end of the week |

Each starts after the item you name, or after the previous phase's closing
milestone, and not before today. Placement reads the plan's weeks the way the
capacity check does: every new item sits inside one week, on study days, in hours
that week has free, so none is too long, starts in a pause or overfills a week.
Parts are grouped under a work item and chained, and the phase's milestone is
made to wait on them when they end before it.

Nothing is written until the preview — the items with their dates, and the
warnings the result has — is confirmed. It lands as one change, with its own
version in the history, so going back to before it undoes it and nothing else.

## People and roadmaps

One Planify serves several people, each with a roadmap of their own. Every row
in the database belongs to a roadmap, and every query names it. Which roadmap a
request acts on is decided once, in the API's middleware, from who Cloudflare
Access signed in. Nothing in a request's body or path picks it.

A **member** is a principal with a roadmap: a person's email, or a service
token's client id. Each principal has one roadmap, and a roadmap can have
several members. Someone Access lets in who is not a member gets `403`, naming
who they signed in as.

Until the first member is added, whoever Access lets in reaches roadmap 1. That
is how the app worked before it had members, so deploying this locks no one
out. The first member closes that for good: from then on only members reach
anything, even if every member is later removed. So **add yourself first**, and
before letting anyone new past Access.

`tools/roadmaps/roadmaps.mjs` manages them, on the local database or the
remote one:

```bash
npm run roadmaps -- --remote list
npm run roadmaps -- --remote add-member 1 you@example.com
npm run roadmaps -- --remote create "Their roadmap" --member them@example.com
npm run roadmaps -- --remote add-member 2 <their service token's client id>
npm run roadmaps -- --remote remove-member them@example.com
```

`create` fills the new roadmap from `templates/starter.json`: one phase, no
items, and a small generic skill map, so the first item can be added at once.
`--template <file>` uses another roadmap file, and `--empty` uses none. The
person also needs to get past Access: add their email to the Access
application's policy.

To load a seed file into a roadmap other than the first, `to-sql.mjs` and
`from-d1.mjs` take `--roadmap N`. `roadmaps.mjs` and `from-d1.mjs` also take
`--env preview`, to work on the test database instead of the real one.

## Agents

Claude Code, Codex or any MCP client can plan through
[planify-mcp](https://github.com/mrmorgan-ai/planify-mcp), a separate Worker that
calls this API with a Cloudflare Access service token. Everything it needs is
here: every write that shapes the plan takes `dryRun` to preview it, and
`draft` to stage it; `/api/issues` lists what the plan breaks. A service token
signs in like a person: add a **Service Auth** policy for it to the planify
Access application.

The MCP server acts for whoever called it. It names that person in the
`X-Planify-On-Behalf-Of` header, and the API answers with their roadmap. Only a
**delegate** may send that header; from anyone else it is refused. Make the MCP
server's own service token a delegate:

```bash
npm run roadmaps -- --remote add-delegate <the MCP server's client id>
```

## API

| Method | Path | Does |
|---|---|---|
| GET | `/api/state` | The whole roadmap with today's date |
| GET | `/api/export` | The roadmap as a seed file, content only, naming the revision it was taken from |
| POST | `/api/edits` | Apply a list of edits to items, work items, phases, pauses, settings or skills as one write; `draft` sends them to the draft, `dryRun` previews them |
| POST | `/api/import` | Replace the roadmap's content with a seed file's, keeping progress; `dryRun` previews it |
| PATCH | `/api/items/:id/state` | Set `pending`, `in_progress` or `done`, and recompute |
| PATCH | `/api/items/:id/dates` | Move an item's planned dates, and recompute; `draft` moves them in the draft, `dryRun` previews the move |
| PATCH | `/api/items/:id/hours` | Declare the hours spent so far, without changing the state |
| POST | `/api/generate` | Add a course, certification, project or practice blocks, placed in the free hours; `dryRun` previews it, `draft` adds to the draft |
| GET | `/api/draft` | The draft's world: its plan with the live roadmap's progress |
| POST | `/api/draft` | Start a draft from the live plan, or open the one in progress |
| DELETE | `/api/draft` | Drop the draft |
| POST | `/api/draft/publish` | Make the draft the plan, keeping progress; `dryRun` previews it |
| POST | `/api/reschedule` | Move every unfinished item by whole weeks so the plan restarts in a date's week |
| POST | `/api/reproject` | Recompute every projection |
| GET | `/api/versions` | The history: what each change to the plan replaced, newest first |
| GET | `/api/versions/:id` | One version as a seed file, naming the revision it was the plan at, for scripts |
| POST | `/api/versions/:id/restore` | Bring a version back, keeping progress; `dryRun` previews it |
| GET | `/api/issues` | Every rule the plan breaks; `?draft=1` for the draft's |
| GET | `/api/health` | Liveness, with the caller's roadmap's item and phase counts |

Every route acts on the caller's roadmap, as the middleware resolved it: see
**People and roadmaps**. The revision, the history and the draft are each
roadmap's own.

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

Edits send `{ revision, edits }` and land together or not at all. An item's id
never changes, and its dates have their own endpoint. `moveItem` puts an item in
a phase, before another item or last, and renumbers the order of both phases. A
new item gets an id from its name and goes last in its phase. Deleting an item
others depend on is refused unless the edit sets `rewire`, which connects them
to what it depended on; a closing milestone cannot be deleted; and an item with
progress is only deleted with `discardProgress`. An edit that cannot be applied as asked
answers `400` saying why.

The same list takes the roadmap's structure. A work item can be created, edited
or deleted; deleting one leaves its parts standing on their own. A phase can be
renamed or given another closing milestone, and phases are added after the last
one, up to six; only an empty last phase can be removed. Pauses are replaced as
a list, and with `keepStudyDays` every unfinished item keeps its study day of the
plan, so a new pause pushes what comes after it. The time zone, start date and
weekly capacity are set together, and the skill map is replaced whole, with
`renamed` carrying a skill's new name into every item that uses it.

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
