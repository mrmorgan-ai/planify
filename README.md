# Planify

A tracker for a long study roadmap: items grouped in phases, with real
dependencies between them and automatic date recalculation when something slips.
Single user, no accounts.

It shows the original plan and the live projection on the same bar, so the
question it answers is "am I ahead or behind today?" rather than "what were the
dates again?".

## The app is open, the roadmap is not

This repository carries the application: the recalculation engine, the API, the
web app and the validator. It deliberately carries no roadmap content — no
items, no phase names, no dates, no non-study periods, no skill map. All of that
is personal, so it lives in the D1 database and in a gitignored seed file.

`seed/roadmap.example.json` is tracked. It is a small fake roadmap that
documents the file's shape and is what CI validates the rules against without
ever seeing the real one.

## Stack

React + Vite on Cloudflare Pages, the API as Pages Functions, Cloudflare D1
(serverless SQLite) for persistence. Access control is Cloudflare Access at the
platform level, so there is no login code here.

## Layout

```
src/core/               pure TypeScript: types, dates, recalculation engine
src/server/             backend helpers that touch the clock
src/ui/                 the React app
functions/api/          route handlers, one file per endpoint
tools/seed/             validator, SQL emitter, and the export back from D1
migrations/             D1 schema, applied with wrangler
seed/roadmap.json       the roadmap — gitignored, never committed
```

`src/core/` is compiled by both `tsconfig.json` (DOM libs, for the UI) and
`tsconfig.worker.json` (Workers types, for the API). That is deliberate: it makes
the compiler enforce that the core stays platform-neutral, which is what lets the
engine be tested with plain fixtures.

The core takes its calendar as an argument — `{ blackouts, timeZone }` — and
never reads a global. That is the same rule seen from the inside: content comes
from the database, not from this repository.

## The five views

| View | What it is for |
|---|---|
| Dashboard | today, hours done against the hours the plan expected by today, overdue count, next milestone and pace, plus the skills radar |
| Backlog | the detail view: one phase at a time, with state, editable dates, resources and price |
| Work items | the roadmap as units — a course with its weeks, a project with its tasks — and how far through each you are |
| Kanban | the day-to-day board for the active phase, with the week's capacity — no limits, no blocking |
| Gantt | read-only: the original plan as a faint bar under the current projection |

Backlog and Kanban write the same `state` field. Neither is a separate system,
and the Gantt and the work items only reflect what those two set.

## Work items

Every item is short enough to finish inside a week, so anything bigger — a
course, a book read across phases, a project — is split into parts. A work item
groups those parts and stores nothing else: its state, hours and phases are read
off the parts, so it cannot disagree with them, and the recalculation engine
never sees it. An item that is not split has no work item and shows as a unit of
one.

The backlog shows a part's place as "3/9" before its name, and its expanded row
links to the work item; the board labels the card the same way. A part with no
link of its own shows its work item's.

An item can also state `doneWhen` — the checkable outcome that makes it finished.
Practice blocks and exam preparations must, because neither has a natural end
the way a chapter does; the board prints it on the card.

## Running it locally

First time:

```bash
npm install
cp seed/roadmap.example.json seed/roadmap.json   # or export the real one, below
npm run seed:validate
npm run seed:sql
npm run db:migrate:local
npx wrangler d1 execute planify --local --file build/seed.sql
```

After that:

```bash
make start                                        # both processes, then waits until they answer
make stop
```

`make start` refuses to start if either port is taken and names what is holding
it, rather than racing whatever is already there. The app is on
`http://127.0.0.1:5173` and the API on `8788`; the footer reports the active
phase, today's date and how far through the plan's hours you are.

Checks: `npm run typecheck` · `npm test` · `npm run build`. Run them without a
pipe — piping hides the exit code and a failing gate then looks green.

## The seed

Content flows in one direction for a load and the other for a restore.

```bash
npm run seed:validate                             # every rule, on every seed file present
npm run seed:sql                                  # -> build/seed.sql (upsert)
npx wrangler d1 execute planify --file build/seed.sql --remote
curl -X POST https://<your-domain>/api/reproject  # recompute projections
```

The upsert updates content and deliberately never touches `state`,
`completed_at` or the projected dates, so reloading the seed cannot overwrite
progress. Planned dates are editable in the app, so they are left alone too —
pass `--with-dates` to `tools/seed/to-sql.mjs` when the seed carries a new
calendar on purpose.

Items and work items the seed no longer contains are deleted, progress and all.
Splitting an item in two means the old one is gone; leaving it behind would count
it twice.

```bash
npm run seed:export                               # D1 -> seed/roadmap.json
```

That is the way back. The database is the durable home of the roadmap, so a new
machine — or a lost disk — recovers the whole seed, including the metadata the
validator checks it against.

Beyond the graph, the validator holds the plan to what a week can take: no item
spans more than seven study days, every item carries an hours estimate, no week is
planned above its declared capacity, the parts of a work item never overlap, and
every practice block and exam preparation says what done means.

The strongest rule in the validator is that with nothing completed, the engine
must project every item exactly onto its own baseline. If a dependency ends on
or after the baseline start of something that waits on it, the plan would be born
already slipped, and the validator says which item.

## Cloudflare setup (once, not automated)

`wrangler.toml` and `migrations/` are the infrastructure as code for the Pages
project and the databases. The things wrangler cannot express are done by hand in
the dashboard and written down here instead of in Terraform — a handful of
resources for a single-user app do not pay for their own state file.

1. `npx wrangler d1 create planify` and `npx wrangler d1 create planify-preview`
   — copy each returned id into `wrangler.toml`, replacing the placeholders.
2. `npm run db:migrate` — applies the schema to the production database.
3. Create the Pages project (dashboard → Workers & Pages → Pages) with
   **direct upload**, named `planify`. Do not connect the Git repository: the
   deploy workflow uploads the build, and the two would otherwise both publish.
4. Bind the databases as `DB` in the project's settings — `planify` for
   production, `planify-preview` for preview.
5. Cloudflare Access → one application covering the project's domain with a
   policy allowing exactly one identity, and a second one covering
   `*.planify.pages.dev` for the preview URLs. This is what makes the app
   private; there is no application-level auth to fall back on.

## Deploying

`.github/workflows/deploy.yml` runs the gates, applies the pending migrations,
then uploads the build — in that order, because code that reads a column the
database does not have yet is a broken deployment. A pull request against `main`
publishes a preview against `planify-preview`; a merge to `main` publishes
production.

It stays dormant until the repository is told the Cloudflare side exists:

- Secrets `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`, the token scoped to
  *Cloudflare Pages: Edit* and *D1: Edit* on this account only.
- Environments `production` and `preview` (Settings → Environments). Adding a
  required reviewer to `production` turns every merge into a deploy you approve.
- Variable `DEPLOY_ENABLED` set to `true`. Until then the workflow is skipped, so
  this file can be merged before any of the above is in place.

Preview deployment URLs are public by default, which is why preview is bound to
its own database and why step 5 covers `*.pages.dev` as well as the real domain.

`npm run deploy` is still there for a manual push from a laptop.

Revisit the by-hand decision if a third environment ever appears, or if the
project has to be recreated from scratch.

## License

MIT — see [LICENSE](LICENSE).
