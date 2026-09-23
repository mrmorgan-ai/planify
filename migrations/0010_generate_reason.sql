-- Items made by a generator are their own reason in the history.
--
-- Filed as an edit, a generation would fold into an edit made a few minutes
-- before it, and going back to before the generation would undo that edit too.
-- As its own reason it always keeps a version of its own.
--
-- SQLite cannot change a CHECK in place, so the table is rebuilt with the rows
-- and ids it has.

CREATE TABLE plan_versions_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('edit', 'import', 'reschedule', 'restore', 'generate')),
  summary TEXT NOT NULL,
  later_changes INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL,
  plan TEXT NOT NULL
);

INSERT INTO plan_versions_next (id, created_at, reason, summary, later_changes, revision, plan)
SELECT id, created_at, reason, summary, later_changes, revision, plan FROM plan_versions;

DROP TABLE plan_versions;

ALTER TABLE plan_versions_next RENAME TO plan_versions;
