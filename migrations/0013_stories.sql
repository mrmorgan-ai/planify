-- Items and work items become tasks, stories and features.
--
-- A task is one scheduled step, finishable inside a week. Every task is a step
-- of a story — a deliverable inside one phase — and a story may serve a feature,
-- a goal wider than a phase. The phase moves from the task to its story.
--
-- The rules are src/core/upgrade.ts's, which turns an old roadmap file the same
-- way, and a test holds the two to the same result:
--
-- - An item becomes a task with the same id, so dependencies and phase
--   milestones keep pointing where they did. Progress is untouched.
-- - A work item whose parts sit in one phase becomes a story with its id.
-- - A work item whose parts cross phases becomes a feature with its id, and a
--   story per phase, `<id>-p<phase>`, named "<name> — phase <n>".
-- - A work item with no parts becomes a story in the roadmap's first phase.
-- - An item on its own becomes the only task of a story `<id>-story`, which
--   takes its link, its extra links and its price.
-- - A story's price is the first one its tasks had, in plan order.
-- - A type is kept on what becomes a story or a feature, where it is an optional
--   label. A task carries none, so an item whose type differs from its work
--   item's — a certification's prep — reads as its story's.
--
-- The plans kept in plan_versions and draft stay as they were written: they are
-- read through the same upgrade, on the way out.

PRAGMA defer_foreign_keys = true;

CREATE TABLE features (
  roadmap_id INTEGER NOT NULL REFERENCES roadmaps (id),
  id         TEXT NOT NULL,
  name       TEXT NOT NULL,
  type       TEXT CHECK (type IS NULL OR type IN ('Certification','Course','Book','Documentation','Paper','Case study','Project','Practice','Exam prep')),
  link       TEXT,
  notes      TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (roadmap_id, id)
);

CREATE TABLE stories (
  roadmap_id INTEGER NOT NULL REFERENCES roadmaps (id),
  id         TEXT NOT NULL,
  name       TEXT NOT NULL,
  type       TEXT CHECK (type IS NULL OR type IN ('Certification','Course','Book','Documentation','Paper','Case study','Project','Practice','Exam prep')),
  phase      INTEGER NOT NULL CHECK (phase BETWEEN 1 AND 6),
  feature_id TEXT,
  link       TEXT,
  resources  TEXT NOT NULL DEFAULT '[]',
  price      TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',
  done_when  TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (roadmap_id, id),
  FOREIGN KEY (roadmap_id, feature_id) REFERENCES features (roadmap_id, id)
);

CREATE TABLE tasks (
  roadmap_id      INTEGER NOT NULL REFERENCES roadmaps (id),
  id              TEXT NOT NULL,
  name            TEXT NOT NULL,
  story_id        TEXT NOT NULL,

  skills          TEXT NOT NULL DEFAULT '[]',
  depends_on      TEXT NOT NULL DEFAULT '[]',

  baseline_start  TEXT NOT NULL,
  baseline_end    TEXT NOT NULL,
  projected_start TEXT NOT NULL,
  projected_end   TEXT NOT NULL,

  link            TEXT,
  notes           TEXT NOT NULL DEFAULT '',

  state           TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','in_progress','done')),
  completed_at    TEXT,
  sort_order      INTEGER NOT NULL,

  duration        TEXT NOT NULL DEFAULT '',
  resources       TEXT NOT NULL DEFAULT '[]',
  done_when       TEXT NOT NULL DEFAULT '',
  hours_done      REAL NOT NULL DEFAULT 0,

  PRIMARY KEY (roadmap_id, id),
  FOREIGN KEY (roadmap_id, story_id) REFERENCES stories (roadmap_id, id),
  CHECK (baseline_end >= baseline_start),
  CHECK (projected_end >= projected_start),
  CHECK ((state = 'done') = (completed_at IS NOT NULL))
);

-- How many phases each work item's parts sit in, and the first of them.
CREATE TABLE upgrade_spans AS
SELECT w.roadmap_id, w.id AS work_item_id,
       COUNT(DISTINCT i.phase) AS phases, MIN(i.phase) AS phase
FROM work_items w
LEFT JOIN items i ON i.roadmap_id = w.roadmap_id AND i.work_item_id = w.id
GROUP BY w.roadmap_id, w.id;

-- Work items that cross phases: a feature each.
INSERT INTO features (roadmap_id, id, name, type, link, notes)
SELECT w.roadmap_id, w.id, w.name, w.type, w.link, w.notes
FROM work_items w
JOIN upgrade_spans s ON s.roadmap_id = w.roadmap_id AND s.work_item_id = w.id
WHERE s.phases > 1;

-- Work items in one phase, or none: a story with the work item's id.
INSERT INTO stories (roadmap_id, id, name, type, phase, feature_id, link, resources, price, notes, done_when)
SELECT w.roadmap_id, w.id, w.name, w.type,
       COALESCE(s.phase, (SELECT MIN(number) FROM phases p WHERE p.roadmap_id = w.roadmap_id), 1),
       NULL, w.link, w.resources,
       COALESCE((SELECT i.price FROM items i
                 WHERE i.roadmap_id = w.roadmap_id AND i.work_item_id = w.id AND i.price <> ''
                 ORDER BY i.phase, i.sort_order LIMIT 1), ''),
       w.notes, ''
FROM work_items w
JOIN upgrade_spans s ON s.roadmap_id = w.roadmap_id AND s.work_item_id = w.id
WHERE s.phases <= 1;

-- Work items that cross phases: a story per phase, serving the feature.
INSERT INTO stories (roadmap_id, id, name, type, phase, feature_id, link, resources, price, notes, done_when)
SELECT w.roadmap_id, w.id || '-p' || ph.phase, w.name || ' — phase ' || ph.phase, w.type,
       ph.phase, w.id, w.link, w.resources,
       COALESCE((SELECT i.price FROM items i
                 WHERE i.roadmap_id = w.roadmap_id AND i.work_item_id = w.id
                   AND i.phase = ph.phase AND i.price <> ''
                 ORDER BY i.sort_order LIMIT 1), ''),
       '', ''
FROM work_items w
JOIN upgrade_spans s ON s.roadmap_id = w.roadmap_id AND s.work_item_id = w.id AND s.phases > 1
JOIN (SELECT DISTINCT roadmap_id, work_item_id, phase FROM items WHERE work_item_id IS NOT NULL) ph
  ON ph.roadmap_id = w.roadmap_id AND ph.work_item_id = w.id;

-- Items on their own: a story each, holding the item's links and price.
INSERT INTO stories (roadmap_id, id, name, type, phase, feature_id, link, resources, price, notes, done_when)
SELECT i.roadmap_id, i.id || '-story', i.name, i.type, i.phase, NULL, i.link, i.resources, i.price, '', ''
FROM items i
WHERE NOT EXISTS (
  SELECT 1 FROM work_items w WHERE w.roadmap_id = i.roadmap_id AND w.id = i.work_item_id
);

INSERT INTO tasks (
  roadmap_id, id, name, story_id, skills, depends_on,
  baseline_start, baseline_end, projected_start, projected_end,
  link, notes, state, completed_at, sort_order, duration, resources, done_when, hours_done
)
SELECT
  i.roadmap_id, i.id, i.name,
  CASE
    WHEN s.work_item_id IS NULL THEN i.id || '-story'
    WHEN s.phases > 1 THEN i.work_item_id || '-p' || i.phase
    ELSE i.work_item_id
  END,
  i.skills, i.depends_on,
  i.baseline_start, i.baseline_end, i.projected_start, i.projected_end,
  CASE WHEN s.work_item_id IS NULL THEN NULL ELSE i.link END,
  i.notes, i.state, i.completed_at, i.sort_order, i.duration,
  CASE WHEN s.work_item_id IS NULL THEN '[]' ELSE i.resources END,
  i.done_when, i.hours_done
FROM items i
LEFT JOIN upgrade_spans s ON s.roadmap_id = i.roadmap_id AND s.work_item_id = i.work_item_id;

-- Phases close on a task now. Rebuilt, since SQLite cannot repoint a foreign key.
CREATE TABLE phases_next (
  roadmap_id           INTEGER NOT NULL REFERENCES roadmaps (id),
  number               INTEGER NOT NULL CHECK (number BETWEEN 1 AND 6),
  name                 TEXT NOT NULL,
  closing_milestone_id TEXT,
  PRIMARY KEY (roadmap_id, number),
  FOREIGN KEY (roadmap_id, closing_milestone_id) REFERENCES tasks (roadmap_id, id)
);

INSERT INTO phases_next (roadmap_id, number, name, closing_milestone_id)
SELECT roadmap_id, number, name, closing_milestone_id FROM phases;

-- Children before parents, so no table is dropped while another still points at it.
DROP TABLE phases;
DROP TABLE items;
DROP TABLE work_items;
DROP TABLE upgrade_spans;

ALTER TABLE phases_next RENAME TO phases;

CREATE INDEX idx_tasks_story ON tasks (roadmap_id, story_id);
CREATE INDEX idx_stories_phase ON stories (roadmap_id, phase);
CREATE INDEX idx_stories_feature ON stories (roadmap_id, feature_id);
