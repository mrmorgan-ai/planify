-- More than one roadmap in the same database, one per person.
--
-- Until now every table held the one roadmap there was. Each row now belongs to
-- a roadmap, every key starts with it, and every query names it, so two
-- people's items can share an id without meeting. The roadmap a request acts on
-- is decided once, by who signed in (see src/server/space.ts), never by the
-- request's body.
--
-- Everything already here becomes roadmap 1. Nothing moves and no progress is
-- touched. No one is a member yet: until the first member is added, whoever
-- Access lets in reaches roadmap 1, exactly as before this migration, so a
-- deploy never locks the owner out. Add yourself first. Adding a member closes
-- that for good (members_required); removing every member later locks everyone
-- out rather than opening roadmap 1 again.
--
-- SQLite cannot change a primary key in place, so every table is rebuilt. The
-- new tables reference each other while they carry temporary names, renaming
-- rewrites those references, and the foreign keys are checked once at the end.

PRAGMA defer_foreign_keys = true;

CREATE TABLE roadmaps (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO roadmaps (id, name, created_at)
VALUES (1, 'Roadmap 1', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

-- Who reaches which roadmap. A principal is what Access signed: a person's
-- email, or a service token's client id. One roadmap per principal; a roadmap
-- may have several.
CREATE TABLE roadmap_members (
  principal  TEXT PRIMARY KEY,
  roadmap_id INTEGER NOT NULL REFERENCES roadmaps (id)
);

CREATE INDEX idx_roadmap_members_roadmap ON roadmap_members (roadmap_id);

-- One row, written with the first member and never removed: from then on only
-- members reach a roadmap, whatever happens to the members table.
CREATE TABLE members_required (
  id    INTEGER PRIMARY KEY CHECK (id = 1),
  since TEXT NOT NULL
);

-- Principals allowed to act on behalf of someone else: the MCP server's service
-- token, which names the person it serves in X-Planify-On-Behalf-Of. Anyone else
-- sending that header is refused.
CREATE TABLE delegates (
  principal TEXT PRIMARY KEY
);

CREATE TABLE work_items_next (
  roadmap_id INTEGER NOT NULL REFERENCES roadmaps (id),
  id         TEXT NOT NULL,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('Certification','Course','Book','Documentation','Paper','Case study','Project','Practice','Exam prep')),
  link       TEXT,
  resources  TEXT NOT NULL DEFAULT '[]',
  notes      TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (roadmap_id, id)
);

CREATE TABLE items_next (
  roadmap_id      INTEGER NOT NULL REFERENCES roadmaps (id),
  id              TEXT NOT NULL,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('Certification','Course','Book','Documentation','Paper','Case study','Project','Practice','Exam prep')),
  phase           INTEGER NOT NULL CHECK (phase BETWEEN 1 AND 6),
  work_item_id    TEXT,

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
  done_when       TEXT NOT NULL DEFAULT '',
  hours_done      REAL NOT NULL DEFAULT 0,

  PRIMARY KEY (roadmap_id, id),
  FOREIGN KEY (roadmap_id, work_item_id) REFERENCES work_items_next (roadmap_id, id),
  CHECK (baseline_end >= baseline_start),
  CHECK (projected_end >= projected_start),
  CHECK ((state = 'done') = (completed_at IS NOT NULL))
);

CREATE TABLE phases_next (
  roadmap_id           INTEGER NOT NULL REFERENCES roadmaps (id),
  number               INTEGER NOT NULL CHECK (number BETWEEN 1 AND 6),
  name                 TEXT NOT NULL,
  closing_milestone_id TEXT,
  PRIMARY KEY (roadmap_id, number),
  FOREIGN KEY (roadmap_id, closing_milestone_id) REFERENCES items_next (roadmap_id, id)
);

CREATE TABLE blackouts_next (
  roadmap_id INTEGER NOT NULL REFERENCES roadmaps (id),
  from_date  TEXT NOT NULL,
  to_date    TEXT NOT NULL,
  reason     TEXT NOT NULL,
  PRIMARY KEY (roadmap_id, from_date),
  CHECK (to_date >= from_date)
);

CREATE TABLE dimensions_next (
  roadmap_id INTEGER NOT NULL REFERENCES roadmaps (id),
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (roadmap_id, name),
  UNIQUE (roadmap_id, sort_order)
);

CREATE TABLE skills_next (
  roadmap_id INTEGER NOT NULL REFERENCES roadmaps (id),
  name       TEXT NOT NULL,
  dimension  TEXT NOT NULL,
  PRIMARY KEY (roadmap_id, name),
  FOREIGN KEY (roadmap_id, dimension) REFERENCES dimensions_next (roadmap_id, name)
);

CREATE TABLE meta_next (
  roadmap_id INTEGER NOT NULL REFERENCES roadmaps (id),
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  PRIMARY KEY (roadmap_id, key)
);

CREATE TABLE plan_versions_next (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  roadmap_id    INTEGER NOT NULL REFERENCES roadmaps (id),
  created_at    TEXT NOT NULL,
  reason        TEXT NOT NULL
    CHECK (reason IN ('edit', 'import', 'reschedule', 'restore', 'generate', 'publish')),
  summary       TEXT NOT NULL,
  later_changes INTEGER NOT NULL DEFAULT 0,
  revision      INTEGER NOT NULL,
  plan          TEXT NOT NULL
);

-- One draft per roadmap.
CREATE TABLE draft_next (
  roadmap_id INTEGER PRIMARY KEY REFERENCES roadmaps (id),
  revision   INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  base_hash  TEXT NOT NULL,
  plan       TEXT NOT NULL
);

INSERT INTO work_items_next (roadmap_id, id, name, type, link, resources, notes)
SELECT 1, id, name, type, link, resources, notes FROM work_items;

INSERT INTO items_next (
  roadmap_id, id, name, type, phase, work_item_id, skills, depends_on,
  baseline_start, baseline_end, projected_start, projected_end,
  price, link, notes, state, completed_at, sort_order, duration, resources, done_when, hours_done
)
SELECT
  1, id, name, type, phase, work_item_id, skills, depends_on,
  baseline_start, baseline_end, projected_start, projected_end,
  price, link, notes, state, completed_at, sort_order, duration, resources, done_when, hours_done
FROM items;

INSERT INTO phases_next (roadmap_id, number, name, closing_milestone_id)
SELECT 1, number, name, closing_milestone_id FROM phases;

INSERT INTO blackouts_next (roadmap_id, from_date, to_date, reason)
SELECT 1, from_date, to_date, reason FROM blackouts;

INSERT INTO dimensions_next (roadmap_id, name, sort_order)
SELECT 1, name, sort_order FROM dimensions;

INSERT INTO skills_next (roadmap_id, name, dimension)
SELECT 1, name, dimension FROM skills;

INSERT INTO meta_next (roadmap_id, key, value)
SELECT 1, key, value FROM meta;

INSERT INTO plan_versions_next (id, roadmap_id, created_at, reason, summary, later_changes, revision, plan)
SELECT id, 1, created_at, reason, summary, later_changes, revision, plan FROM plan_versions;

INSERT INTO draft_next (roadmap_id, revision, started_at, updated_at, base_hash, plan)
SELECT 1, revision, started_at, updated_at, base_hash, plan FROM draft;

-- Children before parents, so no table is dropped while another still points at it.
DROP TABLE phases;
DROP TABLE items;
DROP TABLE work_items;
DROP TABLE skills;
DROP TABLE dimensions;
DROP TABLE blackouts;
DROP TABLE meta;
DROP TABLE plan_versions;
DROP TABLE draft;

ALTER TABLE work_items_next RENAME TO work_items;
ALTER TABLE items_next RENAME TO items;
ALTER TABLE phases_next RENAME TO phases;
ALTER TABLE blackouts_next RENAME TO blackouts;
ALTER TABLE dimensions_next RENAME TO dimensions;
ALTER TABLE skills_next RENAME TO skills;
ALTER TABLE meta_next RENAME TO meta;
ALTER TABLE plan_versions_next RENAME TO plan_versions;
ALTER TABLE draft_next RENAME TO draft;

CREATE INDEX idx_items_phase_order ON items (roadmap_id, phase, sort_order);
CREATE INDEX idx_items_work_item ON items (roadmap_id, work_item_id);
CREATE INDEX idx_plan_versions_roadmap ON plan_versions (roadmap_id, id);
