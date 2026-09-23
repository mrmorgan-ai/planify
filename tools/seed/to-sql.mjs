import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

// For the local database only. The live roadmap changes through an import in the
// app (Settings, or POST /api/import), which checks the file against every rule,
// shows what it changes, and refuses one made from an older revision. None of
// that happens here: this writes whatever the file says.
//
// Emits a seed file as an upsert. Content is updated; state, completed_at and
// the projected dates are left alone, so reloading never touches progress. Run
// `POST /api/reproject` afterwards to recompute projections from the new
// baselines.
//
// Items and work items the file no longer carries are deleted, progress and all.
// The seed is the definition of the roadmap's content: splitting an item in two
// means the old one is gone, and leaving it behind would count it twice.
//
// Pass a path to seed a different file, e.g. the tracked example:
//   node tools/seed/to-sql.mjs seed/roadmap.example.json
//
// Pass --with-dates when the file carries a new calendar on purpose. Without it,
// the planned dates of items already in the database are left as they are.

const root = new URL('../../', import.meta.url)
const args = process.argv.slice(2)
const withDates = args.includes('--with-dates')
const input = args.find((arg) => !arg.startsWith('--')) ?? 'seed/roadmap.json'
const seedPath = new URL(input, root)

if (!existsSync(seedPath)) {
  console.error(`${input} not found. The roadmap is private and lives outside this repository.`)
  console.error(`Copy seed/roadmap.example.json to seed/roadmap.json to start one.`)
  process.exit(1)
}

const raw = readFileSync(seedPath, 'utf8')
const seed = JSON.parse(raw)
const version = createHash('sha256').update(raw).digest('hex').slice(0, 12)

const text = (value) => `'${String(value).replaceAll("'", "''")}'`
const nullable = (value) => (value === null || value === undefined ? 'NULL' : text(value))
const json = (value) => text(JSON.stringify(value))

const statements = []
const workItems = seed.workItems ?? []

// Work items first: items reference them.
for (const workItem of workItems) {
  statements.push(`INSERT INTO work_items (id, name, type, link, resources, notes)
VALUES (
  ${text(workItem.id)}, ${text(workItem.name)}, ${text(workItem.type)},
  ${nullable(workItem.link)}, ${json(workItem.resources ?? [])}, ${text(workItem.notes ?? '')}
)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  type = excluded.type,
  link = excluded.link,
  resources = excluded.resources,
  notes = excluded.notes;`)
}

for (const item of seed.items) {
  // baseline_start and baseline_end are inserted but only updated with
  // --with-dates. They are editable in the app, so a routine reload overwriting
  // them would throw away a deliberate change with no warning — the same reason
  // state, completed_at and the projected dates are left alone.
  statements.push(`INSERT INTO items (
  id, name, type, phase, work_item_id, skills, depends_on,
  baseline_start, baseline_end, projected_start, projected_end,
  price, link, resources, duration, notes, done_when, sort_order
) VALUES (
  ${text(item.id)}, ${text(item.name)}, ${text(item.type)}, ${item.phase},
  ${nullable(item.workItemId)}, ${json(item.skills)}, ${json(item.dependsOn)},
  ${text(item.baselineStartDate)}, ${text(item.baselineEndDate)},
  ${text(item.baselineStartDate)}, ${text(item.baselineEndDate)},
  ${text(item.price)}, ${nullable(item.link)}, ${json(item.resources ?? [])},
  ${text(item.duration)}, ${text(item.notes)}, ${text(item.doneWhen ?? '')}, ${item.sortOrder}
)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  type = excluded.type,
  phase = excluded.phase,
  work_item_id = excluded.work_item_id,
  skills = excluded.skills,
  depends_on = excluded.depends_on,
  price = excluded.price,
  link = excluded.link,
  resources = excluded.resources,
  duration = excluded.duration,
  notes = excluded.notes,
  done_when = excluded.done_when,${
    withDates
      ? `
  baseline_start = excluded.baseline_start,
  baseline_end = excluded.baseline_end,`
      : ''
  }
  sort_order = excluded.sort_order;`)
}

// Phases come after the items: closing_milestone_id references one.
for (const phase of seed.phases) {
  statements.push(`INSERT INTO phases (number, name, closing_milestone_id)
VALUES (${phase.number}, ${text(phase.name)}, ${nullable(phase.closingMilestoneId)})
ON CONFLICT(number) DO UPDATE SET
  name = excluded.name,
  closing_milestone_id = excluded.closing_milestone_id;`)
}

// Retired content goes after the phases, so a closing milestone that moved to a
// new item is already pointing at it by the time the old one is deleted.
const list = (values) => (values.length === 0 ? "''" : values.map(text).join(', '))
statements.push(`DELETE FROM items WHERE id NOT IN (${list(seed.items.map((item) => item.id))});`)
statements.push(
  `DELETE FROM work_items WHERE id NOT IN (${list(workItems.map((workItem) => workItem.id))});`,
)

// A pause is keyed by its first day, so one that moved in the seed would
// otherwise stay behind under its old date and keep blocking study days.
statements.push(
  `DELETE FROM blackouts WHERE from_date NOT IN (${list(seed.blackouts.map((blackout) => blackout.from))});`,
)
for (const blackout of seed.blackouts) {
  statements.push(`INSERT INTO blackouts (from_date, to_date, reason)
VALUES (${text(blackout.from)}, ${text(blackout.to)}, ${text(blackout.reason)})
ON CONFLICT(from_date) DO UPDATE SET
  to_date = excluded.to_date,
  reason = excluded.reason;`)
}

seed.dimensions.forEach((dimension, index) => {
  statements.push(`INSERT INTO dimensions (name, sort_order)
VALUES (${text(dimension)}, ${index + 1})
ON CONFLICT(name) DO UPDATE SET sort_order = excluded.sort_order;`)
})

for (const [skill, dimension] of Object.entries(seed.skills)) {
  statements.push(`INSERT INTO skills (name, dimension)
VALUES (${text(skill)}, ${text(dimension)})
ON CONFLICT(name) DO UPDATE SET dimension = excluded.dimension;`)
}

const meta = {
  time_zone: seed.timeZone,
  weekly_hours_normal: seed.weeklyHours ? String(seed.weeklyHours.normal) : '',
  // The anchor the plan starts on. Taken from the file when it declares one,
  // otherwise the earliest baseline start — which is what it means anyway.
  start_date:
    seed.startDate ??
    seed.items.reduce(
      (earliest, item) =>
        earliest === '' || item.baselineStartDate < earliest ? item.baselineStartDate : earliest,
      '',
    ),
  seed_version: version,
}

for (const [key, value] of Object.entries(meta)) {
  statements.push(`INSERT INTO meta (key, value) VALUES (${text(key)}, ${text(value)})
ON CONFLICT(key) DO UPDATE SET value = excluded.value;`)
}

mkdirSync(new URL('build/', root), { recursive: true })
writeFileSync(
  new URL('build/seed.sql', root),
  `-- Generated by tools/seed/to-sql.mjs from ${input} — do not edit.\n` +
    `-- Seed version ${version}: ${seed.items.length} items, ${workItems.length} work items, ` +
    `${seed.phases.length} phases, ` +
    `${Object.keys(seed.skills).length} skills.\n\n` +
    `${statements.join('\n\n')}\n`,
)

console.log(
  `build/seed.sql${withDates ? ' (with dates)' : ''} — ${seed.items.length} items, ${workItems.length} work items, ` +
    `${seed.phases.length} phases, ` +
    `${seed.blackouts.length} blackouts, ${Object.keys(seed.skills).length} skills, ` +
    `seed version ${version}`,
)
