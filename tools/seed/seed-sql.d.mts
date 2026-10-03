/** A seed file as SQL statements for one roadmap. See seed-sql.mjs. */
export function seedSql(
  seed: unknown,
  options: { roadmapId: number; withDates?: boolean; version: string },
): string[]

/** A parsed roadmap file in the current format, upgrading one in the first. */
export function asCurrentFormat(seed: unknown): unknown
