/** The SQL behind tools/roadmaps/roadmaps.mjs. See roadmaps-sql.mjs. */
export function createRoadmapSql(roadmap: {
  id: number
  name: string
  now: string
  template?: unknown
  version?: string
  member?: string
}): string[]
export function withPack<T extends object>(
  template: T,
  pack: { axes: string[]; skills: Array<{ name: string; axis: string }> },
): T & { dimensions: string[]; skills: Record<string, string> }
export function addMemberSql(roadmapId: number, principal: string): string[]
export function removeMemberSql(principal: string): string[]
export function addDelegateSql(principal: string): string[]
export function removeDelegateSql(principal: string): string[]
export const LIST_SQL: string
