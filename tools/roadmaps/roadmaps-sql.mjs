import { seedSql } from '../seed/seed-sql.mjs'

// The SQL behind tools/roadmaps/roadmaps.mjs, apart from wrangler so it can be
// tested against the schema it runs on.

const text = (value) => `'${String(value).replaceAll("'", "''")}'`

function wholeNumber(value, name) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a whole number from 1, not ${value}`)
  }
  return String(value)
}

function principalOf(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('A principal is an email, or a service token’s client id')
  }
  // Stored as the API compares them: trimmed and lower case (normalPrincipal).
  return text(value.trim().toLowerCase())
}

/**
 * A new roadmap: its row, the settings every roadmap reads, the template's
 * content, and optionally its first member. The settings are the ones the
 * migrations gave the first roadmap; the template then sets its own.
 *
 * @param {{ id: number, name: string, now: string, template?: object, version?: string, member?: string }} roadmap
 * @returns {string[]}
 */
export function createRoadmapSql({ id, name, now, template, version = 'template', member }) {
  const roadmap = wholeNumber(id, 'The roadmap id')
  if (typeof name !== 'string' || name.trim() === '') throw new Error('A roadmap needs a name')

  const statements = [
    `INSERT INTO roadmaps (id, name, created_at) VALUES (${roadmap}, ${text(name.trim())}, ${text(now)});`,
    `INSERT INTO meta (roadmap_id, key, value) VALUES
  (${roadmap}, 'revision', '0'),
  (${roadmap}, 'seed_version', '0'),
  (${roadmap}, 'time_zone', 'UTC'),
  (${roadmap}, 'start_date', ''),
  (${roadmap}, 'weekly_hours_normal', '');`,
  ]
  if (template) {
    statements.push(...seedSql(template, { roadmapId: id, withDates: true, version }))
  }
  if (member !== undefined) statements.push(...addMemberSql(id, member))
  return statements
}

/**
 * Gives a principal a roadmap, or moves them to another one. The first member
 * ever also closes the open door: from then on only members reach anything.
 */
export function addMemberSql(roadmapId, principal) {
  return [
    `INSERT INTO roadmap_members (principal, roadmap_id)
VALUES (${principalOf(principal)}, ${wholeNumber(roadmapId, 'The roadmap id')})
ON CONFLICT(principal) DO UPDATE SET roadmap_id = excluded.roadmap_id;`,
    `INSERT INTO members_required (id, since) VALUES (1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
ON CONFLICT(id) DO NOTHING;`,
  ]
}

export function removeMemberSql(principal) {
  return [`DELETE FROM roadmap_members WHERE principal = ${principalOf(principal)};`]
}

/** Lets a principal — the MCP server's service token — act on behalf of members. */
export function addDelegateSql(principal) {
  return [
    `INSERT INTO delegates (principal) VALUES (${principalOf(principal)})
ON CONFLICT(principal) DO NOTHING;`,
  ]
}

export function removeDelegateSql(principal) {
  return [`DELETE FROM delegates WHERE principal = ${principalOf(principal)};`]
}

/** Every roadmap with its members and size, for `list`. */
export const LIST_SQL = `SELECT r.id, r.name, r.created_at,
  (SELECT COUNT(*) FROM items i WHERE i.roadmap_id = r.id) AS items,
  (SELECT group_concat(principal, ', ') FROM roadmap_members m WHERE m.roadmap_id = r.id) AS members
FROM roadmaps r ORDER BY r.id`
