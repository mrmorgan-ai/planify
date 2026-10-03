// A seed file as SQL statements for one roadmap: an upsert. Used by to-sql.mjs
// for the local database, and by tools/roadmaps to fill a new roadmap from a
// template. None of the app's checks run here: this writes whatever the file says.
//
// Content is updated; state, completed_at and the projected dates are left
// alone, so reloading never touches progress. Run `POST /api/reproject`
// afterwards to recompute projections from the new baselines.
//
// Tasks, stories and features the file no longer carries are deleted, progress
// and all. The seed is the definition of the roadmap's content: splitting a task
// in two means the old one is gone, and leaving it behind would count it twice.
// Only that roadmap's rows are ever deleted.
//
// A file in the first format — items and work items — is upgraded first, by the
// app's own rules.

import { isFormatV1, upgradeV1 } from '../../src/core/upgrade.ts'

/** A parsed roadmap file in the current format, upgrading one in the first. */
export function asCurrentFormat(seed) {
  return isFormatV1(seed) ? upgradeV1(seed) : seed
}

const text = (value) => `'${String(value).replaceAll("'", "''")}'`
const nullable = (value) => (value === null || value === undefined ? 'NULL' : text(value))
const json = (value) => text(JSON.stringify(value))
// Numbers go into the text unquoted, so each is proved a whole number first: a
// file from someone else must not be able to close the statement and add its own.
const integer = (value, at) => {
  if (!Number.isInteger(value)) throw new Error(`${at} must be a whole number, not ${JSON.stringify(value)}`)
  return String(value)
}

/**
 * @param {object} seed the parsed roadmap file
 * @param {{ roadmapId: number, withDates?: boolean, version: string }} options
 *   withDates overwrites the planned dates of tasks already stored, which are
 *   otherwise left as they are because the app can edit them.
 * @returns {string[]} one statement each, in foreign-key order
 */
export function seedSql(file, { roadmapId, withDates = false, version }) {
  if (!Number.isInteger(roadmapId) || roadmapId < 1) {
    throw new Error(`roadmapId must be a positive whole number, not ${roadmapId}`)
  }
  const seed = asCurrentFormat(file)
  const roadmap = String(roadmapId)
  const statements = []
  const features = seed.features ?? []
  const stories = seed.stories ?? []

  // Features first, then stories, then tasks: each references the one before.
  for (const feature of features) {
    statements.push(`INSERT INTO features (roadmap_id, id, name, type, link, notes)
VALUES (${roadmap}, ${text(feature.id)}, ${text(feature.name)}, ${nullable(feature.type)}, ${nullable(feature.link)}, ${text(feature.notes ?? '')})
ON CONFLICT(roadmap_id, id) DO UPDATE SET
  name = excluded.name,
  type = excluded.type,
  link = excluded.link,
  notes = excluded.notes;`)
  }

  for (const story of stories) {
    statements.push(`INSERT INTO stories (roadmap_id, id, name, type, phase, feature_id, link, resources, price, notes, done_when)
VALUES (
  ${roadmap}, ${text(story.id)}, ${text(story.name)}, ${nullable(story.type)}, ${integer(story.phase, `${story.id}.phase`)},
  ${nullable(story.featureId)}, ${nullable(story.link)}, ${json(story.resources ?? [])},
  ${text(story.price ?? '')}, ${text(story.notes ?? '')}, ${text(story.doneWhen ?? '')}
)
ON CONFLICT(roadmap_id, id) DO UPDATE SET
  name = excluded.name,
  type = excluded.type,
  phase = excluded.phase,
  feature_id = excluded.feature_id,
  link = excluded.link,
  resources = excluded.resources,
  price = excluded.price,
  notes = excluded.notes,
  done_when = excluded.done_when;`)
  }

  for (const task of seed.tasks) {
    // baseline_start and baseline_end are inserted but only updated with
    // withDates. They are editable in the app, so a routine reload overwriting
    // them would throw away a deliberate change with no warning — the same reason
    // state, completed_at and the projected dates are left alone.
    statements.push(`INSERT INTO tasks (
  roadmap_id, id, name, story_id, skills, depends_on,
  baseline_start, baseline_end, projected_start, projected_end,
  link, resources, duration, notes, done_when, sort_order
) VALUES (
  ${roadmap}, ${text(task.id)}, ${text(task.name)},
  ${text(task.storyId)}, ${json(task.skills)}, ${json(task.dependsOn)},
  ${text(task.baselineStartDate)}, ${text(task.baselineEndDate)},
  ${text(task.baselineStartDate)}, ${text(task.baselineEndDate)},
  ${nullable(task.link)}, ${json(task.resources ?? [])},
  ${text(task.duration ?? '')}, ${text(task.notes ?? '')}, ${text(task.doneWhen ?? '')}, ${integer(task.sortOrder, `${task.id}.sortOrder`)}
)
ON CONFLICT(roadmap_id, id) DO UPDATE SET
  name = excluded.name,
  story_id = excluded.story_id,
  skills = excluded.skills,
  depends_on = excluded.depends_on,
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

  // Phases come after the tasks: closing_milestone_id references one.
  for (const phase of seed.phases) {
    statements.push(`INSERT INTO phases (roadmap_id, number, name, closing_milestone_id)
VALUES (${roadmap}, ${integer(phase.number, 'phase.number')}, ${text(phase.name)}, ${nullable(phase.closingMilestoneId)})
ON CONFLICT(roadmap_id, number) DO UPDATE SET
  name = excluded.name,
  closing_milestone_id = excluded.closing_milestone_id;`)
  }

  // Retired content goes after the phases, so a closing milestone that moved to a
  // new task is already pointing at it by the time the old one is deleted.
  const list = (values) => (values.length === 0 ? "''" : values.map(text).join(', '))
  statements.push(
    `DELETE FROM tasks WHERE roadmap_id = ${roadmap} AND id NOT IN (${list(seed.tasks.map((task) => task.id))});`,
  )
  statements.push(
    `DELETE FROM stories WHERE roadmap_id = ${roadmap} AND id NOT IN (${list(stories.map((story) => story.id))});`,
  )
  statements.push(
    `DELETE FROM features WHERE roadmap_id = ${roadmap} AND id NOT IN (${list(features.map((feature) => feature.id))});`,
  )

  // A pause is keyed by its first day, so one that moved in the seed would
  // otherwise stay behind under its old date and keep blocking study days.
  statements.push(
    `DELETE FROM blackouts WHERE roadmap_id = ${roadmap} AND from_date NOT IN (${list(seed.blackouts.map((blackout) => blackout.from))});`,
  )
  for (const blackout of seed.blackouts) {
    statements.push(`INSERT INTO blackouts (roadmap_id, from_date, to_date, reason)
VALUES (${roadmap}, ${text(blackout.from)}, ${text(blackout.to)}, ${text(blackout.reason)})
ON CONFLICT(roadmap_id, from_date) DO UPDATE SET
  to_date = excluded.to_date,
  reason = excluded.reason;`)
  }

  seed.dimensions.forEach((dimension, index) => {
    statements.push(`INSERT INTO dimensions (roadmap_id, name, sort_order)
VALUES (${roadmap}, ${text(dimension)}, ${index + 1})
ON CONFLICT(roadmap_id, name) DO UPDATE SET sort_order = excluded.sort_order;`)
  })

  for (const [skill, dimension] of Object.entries(seed.skills)) {
    statements.push(`INSERT INTO skills (roadmap_id, name, dimension)
VALUES (${roadmap}, ${text(skill)}, ${text(dimension)})
ON CONFLICT(roadmap_id, name) DO UPDATE SET dimension = excluded.dimension;`)
  }

  const meta = {
    time_zone: seed.timeZone,
    weekly_hours_normal: seed.weeklyHours ? String(seed.weeklyHours.normal) : '',
    // The anchor the plan starts on. Taken from the file when it declares one,
    // otherwise the earliest baseline start — which is what it means anyway.
    start_date:
      seed.startDate ??
      seed.tasks.reduce(
        (earliest, task) =>
          earliest === '' || task.baselineStartDate < earliest ? task.baselineStartDate : earliest,
        '',
      ),
    seed_version: version,
  }

  for (const [key, value] of Object.entries(meta)) {
    statements.push(`INSERT INTO meta (roadmap_id, key, value) VALUES (${roadmap}, ${text(key)}, ${text(value)})
ON CONFLICT(roadmap_id, key) DO UPDATE SET value = excluded.value;`)
  }

  return statements
}
