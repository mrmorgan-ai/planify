-- A roadmap may have more than six phases.
--
-- The cap was a CHECK on stories.phase and phases.number. It is application
-- structure, so it now lives in MAX_PHASES (src/core/constants.ts) and the
-- database only requires a phase to be a positive number: raising the cap later
-- needs no migration.
--
-- SQLite cannot alter a CHECK, so stories, tasks and phases are rebuilt the way
-- 0013 did it: the new tables first, children dropped before parents, every row
-- copied as it was.

PRAGMA defer_foreign_keys = true;

CREATE TABLE stories_next (
  roadmap_id INTEGER NOT NULL REFERENCES roadmaps (id),
  id         TEXT NOT NULL,
  name       TEXT NOT NULL,
  type       TEXT CHECK (type IS NULL OR type IN ('Certification','Course','Book','Documentation','Paper','Case study','Project','Practice','Exam prep')),
  phase      INTEGER NOT NULL CHECK (phase >= 1),
  feature_id TEXT,
  link       TEXT,
  resources  TEXT NOT NULL DEFAULT '[]',
  price      TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',
  done_when  TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (roadmap_id, id),
  FOREIGN KEY (roadmap_id, feature_id) REFERENCES features (roadmap_id, id)
);

INSERT INTO stories_next (roadmap_id, id, name, type, phase, feature_id, link, resources, price, notes, done_when)
SELECT roadmap_id, id, name, type, phase, feature_id, link, resources, price, notes, done_when FROM stories;

CREATE TABLE tasks_next (
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
  FOREIGN KEY (roadmap_id, story_id) REFERENCES stories_next (roadmap_id, id),
  CHECK (baseline_end >= baseline_start),
  CHECK (projected_end >= projected_start),
  CHECK ((state = 'done') = (completed_at IS NOT NULL))
);

INSERT INTO tasks_next (
  roadmap_id, id, name, story_id, skills, depends_on,
  baseline_start, baseline_end, projected_start, projected_end,
  link, notes, state, completed_at, sort_order,
  duration, resources, done_when, hours_done
)
SELECT
  roadmap_id, id, name, story_id, skills, depends_on,
  baseline_start, baseline_end, projected_start, projected_end,
  link, notes, state, completed_at, sort_order,
  duration, resources, done_when, hours_done
FROM tasks;

-- Phases point at tasks, so they are kept aside, dropped, and rebuilt last.
CREATE TABLE phases_keep AS
SELECT roadmap_id, number, name, closing_milestone_id FROM phases;

DROP TABLE phases;
DROP TABLE tasks;
DROP TABLE stories;

ALTER TABLE stories_next RENAME TO stories;
ALTER TABLE tasks_next RENAME TO tasks;

CREATE TABLE phases (
  roadmap_id           INTEGER NOT NULL REFERENCES roadmaps (id),
  number               INTEGER NOT NULL CHECK (number >= 1),
  name                 TEXT NOT NULL,
  closing_milestone_id TEXT,
  PRIMARY KEY (roadmap_id, number),
  FOREIGN KEY (roadmap_id, closing_milestone_id) REFERENCES tasks (roadmap_id, id)
);

INSERT INTO phases (roadmap_id, number, name, closing_milestone_id)
SELECT roadmap_id, number, name, closing_milestone_id FROM phases_keep;

DROP TABLE phases_keep;

CREATE INDEX idx_tasks_story ON tasks (roadmap_id, story_id);
CREATE INDEX idx_stories_phase ON stories (roadmap_id, phase);
CREATE INDEX idx_stories_feature ON stories (roadmap_id, feature_id);
