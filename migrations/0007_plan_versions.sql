-- Every version of the plan a reschedule replaced.
--
-- Rescheduling rewrites the planned dates of every unfinished item, and to the
-- person using the app the new dates simply are the plan. The system keeps what
-- was there before, so a reschedule can be compared or undone later. Nothing in
-- the app reads this table yet.
--
-- `plan` is the whole roadmap as it stood, one JSON object per item:
-- {id, state, baselineStart, baselineEnd, projectedStart, projectedEnd}.

CREATE TABLE plan_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('reschedule')),
  restart_date TEXT NOT NULL,
  shift_days INTEGER NOT NULL,
  plan TEXT NOT NULL
);
