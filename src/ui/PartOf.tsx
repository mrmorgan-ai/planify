import { Link as RouterLink } from 'react-router-dom'
import type { PartLabel } from '../core/workItems'

/**
 * "Part 3 of 9 · Phase 2 project" under the name: the row is one piece of a
 * larger unit, and the link opens that unit with all its parts.
 */
export function PartOf({ part }: { part: PartLabel }) {
  return (
    <div className="part-of">
      <RouterLink to={`/work-items?unit=${encodeURIComponent(part.workItem.id)}`}>
        Part {part.index} of {part.total} · {part.workItem.name}
      </RouterLink>
    </div>
  )
}
