-- A draft of the plan: changes staged apart from the live roadmap, reviewed
-- with their own warnings and Gantt, then published as one change.
--
-- There is one draft at a time, shared by every device. It holds the plan only,
-- as the roadmap file has it; progress is always read from the live roadmap, so
-- ticking an item off while a draft is open is never lost. `base_hash` is the
-- live plan's fingerprint when the draft started, which is how publishing knows
-- the live plan has changed since.

CREATE TABLE draft (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  -- Bumped on every change to the draft, like the roadmap's own revision.
  revision INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  base_hash TEXT NOT NULL,
  plan TEXT NOT NULL
);

-- Publishing a draft is its own reason in the history. SQLite cannot change a
-- CHECK in place, so the table is rebuilt with the rows and ids it has.

CREATE TABLE plan_versions_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  reason TEXT NOT NULL
    CHECK (reason IN ('edit', 'import', 'reschedule', 'restore', 'generate', 'publish')),
  summary TEXT NOT NULL,
  later_changes INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL,
  plan TEXT NOT NULL
);

INSERT INTO plan_versions_next (id, created_at, reason, summary, later_changes, revision, plan)
SELECT id, created_at, reason, summary, later_changes, revision, plan FROM plan_versions;

DROP TABLE plan_versions;

ALTER TABLE plan_versions_next RENAME TO plan_versions;
