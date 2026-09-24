/** The SQL behind tools/roadmaps/roadmaps.mjs. See roadmaps-sql.mjs. */
export function createRoadmapSql(roadmap: {
  id: number
  name: string
  now: string
  template?: unknown
  version?: string
  member?: string
}): string[]
export function addMemberSql(roadmapId: number, principal: string): string[]
export function removeMemberSql(principal: string): string[]
export function addDelegateSql(principal: string): string[]
export function removeDelegateSql(principal: string): string[]
export const LIST_SQL: string
