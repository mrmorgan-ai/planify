import { Link as RouterLink } from 'react-router-dom'
import { estimatedHours, progressHours } from '../core/hours'
import type { Task, Resource } from '../core/types'
import type { TaskLabel } from '../core/stories'

/**
 * Everything about one task that is not its state or its dates: what it is, what
 * finishing it means, the story it belongs to, and what it waits on. One
 * component and not a copy per view, because the backlog row and the board card
 * answer the same question and two copies of an answer drift.
 */
export function TaskDetail({
  task,
  part,
  links,
  names,
  showResources = false,
  showProgress = true,
}: {
  task: Task
  /** Which story this task is a step of; null only when that story is missing. */
  part: TaskLabel | null
  /** Its own links, or its story's when it carries none. */
  links: { link: string | null; resources: Resource[] }
  /** Dependency names, so the list reads as names instead of ids. */
  names: Map<string, string>
  /** The backlog keeps resources in their own column; the board has no column. */
  showResources?: boolean
  /** The board declares hours right below this, so it does not want them twice. */
  showProgress?: boolean
}) {
  const hasLinks = links.link !== null || links.resources.length > 0
  const estimate = estimatedHours(task)
  const done = progressHours(task)

  return (
    <div className="task-detail">
      {task.duration && (
        <div className="detail-line">
          <span className="detail-label">Duration</span>
          <span>{task.duration}</span>
        </div>
      )}

      {showProgress && estimate !== null && done > 0 && (
        <div className="detail-line">
          <span className="detail-label">Hours done</span>
          <span>
            {trim(done)} of {trim(estimate)}h
          </span>
        </div>
      )}

      {task.notes && (
        <div className="detail-line">
          <span className="detail-label">What it is</span>
          <span className="notes">{task.notes}</span>
        </div>
      )}

      {task.doneWhen && (
        <div className="detail-line">
          <span className="detail-label">Done when</span>
          <span className="notes">{task.doneWhen}</span>
        </div>
      )}

      {showResources && hasLinks && (
        <div className="detail-line">
          <span className="detail-label">Resources</span>
          <span className="resources">
            {links.link && (
              <a href={links.link} target="_blank" rel="noreferrer" draggable={false}>
                {hostOf(links.link)}
              </a>
            )}
            {links.resources.map((resource) => (
              <a
                key={resource.url}
                href={resource.url}
                target="_blank"
                rel="noreferrer"
                draggable={false}
              >
                {resource.label}
              </a>
            ))}
          </span>
        </div>
      )}

      {part && (
        <div className="detail-line">
          <span className="detail-label">Story</span>
          <span className="notes">
            <RouterLink
              className="part-link"
              to={`/backlog?story=${encodeURIComponent(part.story.id)}`}
              draggable={false}
            >
              {part.story.name}
            </RouterLink>{' '}
            <span className="faint">
              · task {part.index} of {part.total}
            </span>
            {part.story.notes && <div>{part.story.notes}</div>}
          </span>
        </div>
      )}

      {task.skills.length > 0 && (
        <div className="detail-line">
          <span className="detail-label">Skills</span>
          <span className="skills">
            {task.skills.map((skill) => (
              <span key={skill} className="skill">
                {skill}
              </span>
            ))}
          </span>
        </div>
      )}

      {part?.story.price && (
        <div className="detail-line">
          <span className="detail-label">Price</span>
          <span className="notes">{part.story.price}</span>
        </div>
      )}

      <div className="detail-line">
        <span className="detail-label">Depends on</span>
        <span className="depends">
          {task.dependsOn.length === 0
            ? 'nothing — it can be started at any time'
            : task.dependsOn.map((id) => names.get(id) ?? id).join(' · ')}
        </span>
      </div>
    </div>
  )
}

function trim(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1)
}

/** The domain, so a link says where it goes instead of saying "open". */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'link'
  }
}
