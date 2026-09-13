-- Work items, and two item types.
--
-- A work item groups the parts of one unit — a course cut by week, a book read
-- across phases, a project in numbered tasks. It stores what the unit is and
-- nothing that can be derived: no dates, no state, no dependencies. Those stay on
-- the parts, so the engine never learns work items exist.
--
-- 'Practice' is the weekly block that applies what the week covered, and
-- 'Exam prep' keeps exam guides and practice exams apart from the exam itself.
-- The type is a CHECK constraint, and SQLite cannot alter one, so the items table
-- is rebuilt. Phases reference items through their closing milestone, and
-- dropping the old table counts every one of those references as a violation
-- that renaming the new table does not clear. So the milestones are set aside
-- first and put back once the new table holds the same ids.

PRAGMA defer_foreign_keys = true;

CREATE TABLE phase_milestones AS SELECT number, closing_milestone_id FROM phases;
UPDATE phases SET closing_milestone_id = NULL;

CREATE TABLE work_items (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  type      TEXT NOT NULL CHECK (type IN ('Certification','Course','Book','Documentation','Paper','Case study','Project','Practice','Exam prep')),
  link      TEXT,
  resources TEXT NOT NULL DEFAULT '[]',
  notes     TEXT NOT NULL DEFAULT ''
);

CREATE TABLE items_rebuilt (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('Certification','Course','Book','Documentation','Paper','Case study','Project','Practice','Exam prep')),
  phase           INTEGER NOT NULL CHECK (phase BETWEEN 1 AND 6),
  -- Null for an item that stands on its own: it is its own unit of one, and
  -- storing a work item per standalone item would say the same thing twice.
  work_item_id    TEXT REFERENCES work_items (id),

  skills          TEXT NOT NULL DEFAULT '[]',
  depends_on      TEXT NOT NULL DEFAULT '[]',

  baseline_start  TEXT NOT NULL,
  baseline_end    TEXT NOT NULL,
  projected_start TEXT NOT NULL,
  projected_end   TEXT NOT NULL,

  price           TEXT NOT NULL DEFAULT '',
  link            TEXT,
  notes           TEXT NOT NULL DEFAULT '',

  state           TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','in_progress','done')),
  completed_at    TEXT,
  sort_order      INTEGER NOT NULL,

  duration        TEXT NOT NULL DEFAULT '',
  resources       TEXT NOT NULL DEFAULT '[]',

  CHECK (baseline_end >= baseline_start),
  CHECK (projected_end >= projected_start),
  CHECK ((state = 'done') = (completed_at IS NOT NULL))
);

INSERT INTO items_rebuilt (
  id, name, type, phase, work_item_id, skills, depends_on,
  baseline_start, baseline_end, projected_start, projected_end,
  price, link, notes, state, completed_at, sort_order, duration, resources
)
SELECT
  id, name, type, phase, NULL, skills, depends_on,
  baseline_start, baseline_end, projected_start, projected_end,
  price, link, notes, state, completed_at, sort_order, duration, resources
FROM items;

DROP TABLE items;
ALTER TABLE items_rebuilt RENAME TO items;

CREATE INDEX idx_items_phase_order ON items (phase, sort_order);
CREATE INDEX idx_items_work_item ON items (work_item_id);

UPDATE phases SET closing_milestone_id = (
  SELECT closing_milestone_id FROM phase_milestones WHERE phase_milestones.number = phases.number
);
DROP TABLE phase_milestones;
