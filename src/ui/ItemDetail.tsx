import { Link as RouterLink } from 'react-router-dom'
import type { Item, Resource } from '../core/types'
import type { PartLabel } from '../core/workItems'

/**
 * Everything about one item that is not its state or its dates: what it is, what
 * finishing it means, the unit it belongs to, and what it waits on. One
 * component and not a copy per view, because the backlog row and the board card
 * answer the same question and two copies of an answer drift.
 */
export function ItemDetail({
  item,
  part,
  links,
  names,
  showResources = false,
}: {
  item: Item
  /** Which work item this item is a part of, when it is one. */
  part: PartLabel | null
  /** Its own links, or its work item's when it carries none. */
  links: { link: string | null; resources: Resource[] }
  /** Dependency names, so the list reads as names instead of ids. */
  names: Map<string, string>
  /** The backlog keeps resources in their own column; the board has no column. */
  showResources?: boolean
}) {
  const hasLinks = links.link !== null || links.resources.length > 0

  return (
    <div className="item-detail">
      {item.duration && (
        <div className="detail-line">
          <span className="detail-label">Duration</span>
          <span>{item.duration}</span>
        </div>
      )}

      {item.notes && (
        <div className="detail-line">
          <span className="detail-label">What it is</span>
          <span className="notes">{item.notes}</span>
        </div>
      )}

      {item.doneWhen && (
        <div className="detail-line">
          <span className="detail-label">Done when</span>
          <span className="notes">{item.doneWhen}</span>
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
          <span className="detail-label">Part of</span>
          <span className="notes">
            <RouterLink
              className="part-link"
              to={`/work-items?unit=${encodeURIComponent(part.workItem.id)}`}
              draggable={false}
            >
              {part.workItem.name}
            </RouterLink>{' '}
            <span className="faint">
              · part {part.index} of {part.total}
            </span>
            {part.workItem.notes && <div>{part.workItem.notes}</div>}
          </span>
        </div>
      )}

      {item.skills.length > 0 && (
        <div className="detail-line">
          <span className="detail-label">Skills</span>
          <span className="skills">
            {item.skills.map((skill) => (
              <span key={skill} className="skill">
                {skill}
              </span>
            ))}
          </span>
        </div>
      )}

      {item.price && (
        <div className="detail-line">
          <span className="detail-label">Price</span>
          <span className="notes">{item.price}</span>
        </div>
      )}

      <div className="detail-line">
        <span className="detail-label">Depends on</span>
        <span className="depends">
          {item.dependsOn.length === 0
            ? 'nothing — it can be started at any time'
            : item.dependsOn.map((id) => names.get(id) ?? id).join(' · ')}
        </span>
      </div>
    </div>
  )
}

/** The domain, so a link says where it goes instead of saying "open". */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'link'
  }
}
