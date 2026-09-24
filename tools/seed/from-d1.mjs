import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

// Rebuilds seed/roadmap.json from the database. The roadmap is private and not
// in this repository, so D1 is its durable home — this is the way back from the
// database to a file you can edit, on this machine or a new one. For the live
// roadmap, Settings → Download in the app gives the same file without wrangler.
//
//   node tools/seed/from-d1.mjs --remote    (production)
//   node tools/seed/from-d1.mjs --local     (the local dev database)
//
// Add --roadmap N for a roadmap other than the first, and --env preview to read
// the test database instead of the real one.

const args = process.argv.slice(2)
const target = args[0] ?? '--remote'
if (target !== '--remote' && target !== '--local') {
  console.error(`Expected --remote or --local, got ${target}`)
  process.exit(1)
}
const roadmapAt = args.indexOf('--roadmap')
const roadmapId = roadmapAt === -1 ? 1 : Number(args[roadmapAt + 1])
if (!Number.isInteger(roadmapId) || roadmapId < 1) {
  console.error(`--roadmap takes a roadmap id, a whole number from 1; got ${args[roadmapAt + 1]}`)
  process.exit(1)
}
const envAt = args.indexOf('--env')
const env = envAt === -1 ? undefined : args[envAt + 1]
if (env !== undefined && (env === '' || env.startsWith('--'))) {
  console.error('--env takes an environment name, such as preview')
  process.exit(1)
}
const database = env === undefined ? ['DB'] : ['DB', '--env', env]
// Safe to interpolate: checked to be a whole number above.
const mine = `roadmap_id = ${roadmapId}`

const query = (sql) => {
  const stdout = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', ...database, target, '--json', '--command', sql],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  // Wrangler may print a banner before the JSON payload.
  const start = stdout.indexOf('[')
  if (start === -1) throw new Error(`No JSON in wrangler output for: ${sql}`)
  return JSON.parse(stdout.slice(start))[0].results
}

const metaRows = query(`SELECT key, value FROM meta WHERE ${mine}`)
const meta = Object.fromEntries(metaRows.map((row) => [row.key, row.value]))

const roadmap = {
  timeZone: meta.time_zone ?? 'UTC',
  startDate: meta.start_date || undefined,
  weeklyHours: meta.weekly_hours_normal
    ? { normal: Number(meta.weekly_hours_normal) }
    : undefined,
  phases: query(`SELECT number, name, closing_milestone_id FROM phases WHERE ${mine} ORDER BY number`).map(
    (row) => ({
      number: row.number,
      name: row.name,
      closingMilestoneId: row.closing_milestone_id ?? null,
    }),
  ),
  blackouts: query(`SELECT from_date, to_date, reason FROM blackouts WHERE ${mine} ORDER BY from_date`).map(
    (row) => ({ from: row.from_date, to: row.to_date, reason: row.reason }),
  ),
  dimensions: query(`SELECT name FROM dimensions WHERE ${mine} ORDER BY sort_order`).map((row) => row.name),
  // Grouped by axis rather than alphabetically: this file is hand-edited, and
  // the grouping is what makes a 70-skill map readable.
  skills: Object.fromEntries(
    query(
      `SELECT s.name, s.dimension FROM skills s
       JOIN dimensions d ON d.roadmap_id = s.roadmap_id AND d.name = s.dimension
       WHERE s.${mine}
       ORDER BY d.sort_order, s.name`,
    ).map((row) => [row.name, row.dimension]),
  ),
  workItems: query(`SELECT id, name, type, link, resources, notes FROM work_items WHERE ${mine} ORDER BY id`).map(
    (row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      link: row.link ?? null,
      resources: JSON.parse(row.resources === '' ? '[]' : row.resources),
      notes: row.notes,
    }),
  ),
  items: query(
    `SELECT id, name, type, phase, work_item_id, skills, depends_on, baseline_start, baseline_end,
            price, link, resources, duration, notes, done_when, sort_order
     FROM items WHERE ${mine} ORDER BY phase, sort_order`,
  ).map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    phase: row.phase,
    workItemId: row.work_item_id ?? null,
    skills: JSON.parse(row.skills),
    baselineStartDate: row.baseline_start,
    baselineEndDate: row.baseline_end,
    dependsOn: JSON.parse(row.depends_on),
    price: row.price,
    link: row.link ?? null,
    resources: JSON.parse(row.resources === '' ? '[]' : row.resources),
    duration: row.duration,
    notes: row.notes,
    doneWhen: row.done_when ?? '',
    sortOrder: row.sort_order,
  })),
}

// The first roadmap of the real database is the one this repository has always
// exported; any other roadmap, or any other environment, gets a file of its own,
// so exporting it never overwrites that one.
const name = ['roadmap', env, roadmapId === 1 ? undefined : roadmapId].filter(Boolean).join('-')
const out = new URL(`../../seed/${name}.json`, import.meta.url)
writeFileSync(out, `${JSON.stringify(roadmap, null, 2)}\n`)

console.log(
  `${out.pathname.split('/').slice(-2).join('/')} — ${roadmap.items.length} items, ${roadmap.workItems.length} work items, ` +
    `${roadmap.phases.length} phases, ` +
    `${Object.keys(roadmap.skills).length} skills, from roadmap ${roadmapId} in ${target.slice(2)} D1`,
)
