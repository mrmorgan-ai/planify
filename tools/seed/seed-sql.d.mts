/** A seed file as SQL statements for one roadmap. See seed-sql.mjs. */
export function seedSql(
  seed: unknown,
  options: { roadmapId: number; withDates?: boolean; version: string },
): string[]
