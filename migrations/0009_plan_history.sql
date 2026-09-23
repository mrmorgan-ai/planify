-- The plan as it stood before each change to it, so any of them can be undone.
--
-- 0007 kept only what a reschedule replaced, and only its dates: enough to
-- compare, not to go back. Every change to the plan now keeps a version, and a
-- version is the whole plan as the roadmap file has it — items, work items,
-- phases, pauses, capacity and skills. Progress is not in it: restoring a
-- version brings the plan back, and what has been done stays done.
--
-- A tick or hours logged is progress, not a change of plan, and keeps nothing.
-- Edits a few minutes apart are one change: the version before the first is
-- kept, and `later_changes` counts the ones folded into it. The table holds the
-- newest 50; older ones are dropped as new ones arrive.
--
-- The two rows 0007 held carried dates only and cannot be restored, so the
-- table starts again empty.

DROP TABLE plan_versions;

CREATE TABLE plan_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- When the change that replaced this plan was made.
  created_at TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('edit', 'import', 'reschedule', 'restore')),
  -- What that change did, in a line: "Edited Read the thing (name)".
  summary TEXT NOT NULL,
  later_changes INTEGER NOT NULL DEFAULT 0,
  -- The revision the roadmap was at with this plan.
  revision INTEGER NOT NULL,
  -- The plan, as the roadmap file.
  plan TEXT NOT NULL
);
