-- Moves the local plan so it starts on the Monday four weeks ago, keeping its
-- shape: every item, completion, pause and the plan's start move by the same
-- number of days. Leaves an empty database alone.
--
-- Only the plan moves. The projections are left for the engine: a projection
-- shifted here would carry over whatever was stale in it, so `make
-- start-overdue` calls /api/reproject once the API is up.
--
-- Local database only — `make start-overdue` runs it with --local. It rewrites
-- dates, so never point it at the real roadmap.
--
-- D1 has no temporary tables, so the shift waits in a meta row and is removed at
-- the end.

INSERT INTO meta (key, value)
  SELECT 'dev_shift',
         (julianday(date('now', 'weekday 1', '-28 days')) - julianday(MIN(baseline_start))) || ' days'
  FROM items
  HAVING COUNT(*) > 0;

UPDATE items SET
  baseline_start = date(baseline_start, (SELECT value FROM meta WHERE key = 'dev_shift')),
  baseline_end   = date(baseline_end,   (SELECT value FROM meta WHERE key = 'dev_shift'))
WHERE EXISTS (SELECT 1 FROM meta WHERE key = 'dev_shift');

UPDATE items SET
  completed_at = strftime('%Y-%m-%dT%H:%M:%SZ', completed_at,
                          (SELECT value FROM meta WHERE key = 'dev_shift'))
WHERE completed_at IS NOT NULL
  AND EXISTS (SELECT 1 FROM meta WHERE key = 'dev_shift');

UPDATE blackouts SET
  from_date = date(from_date, (SELECT value FROM meta WHERE key = 'dev_shift')),
  to_date   = date(to_date,   (SELECT value FROM meta WHERE key = 'dev_shift'))
WHERE EXISTS (SELECT 1 FROM meta WHERE key = 'dev_shift');

UPDATE meta SET value = date(value, (SELECT value FROM meta WHERE key = 'dev_shift'))
WHERE key = 'start_date' AND value <> ''
  AND EXISTS (SELECT 1 FROM meta WHERE key = 'dev_shift');

DELETE FROM meta WHERE key = 'dev_shift';
