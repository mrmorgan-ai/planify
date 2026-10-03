import { Link as RouterLink } from 'react-router-dom'
import type { TaskLabel } from '../core/stories'

/**
 * "Task 3 of 9 · Phase 2 project" under the name: the row is one step of a
 * story, and the link opens that story with all its tasks.
 */
export function PartOf({ part }: { part: TaskLabel }) {
  return (
    <div className="part-of">
      <RouterLink to={`/stories?story=${encodeURIComponent(part.story.id)}`}>
        Task {part.index} of {part.total} · {part.story.name}
      </RouterLink>
    </div>
  )
}
