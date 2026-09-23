-- The seed used to carry three expectations the validator checked its content
-- against: an item count per phase, a date window per phase, and the items a
-- closing milestone was allowed not to wait on. They existed to catch mistakes
-- in a hand-edited file. The validator now reads each phase's window off its
-- items, a count is whatever the phase holds, and a milestone that skips an item
-- is a warning rather than an exception to declare — so nothing reads them.

DELETE FROM meta
WHERE key IN ('expected_items_per_phase', 'phase_windows', 'milestone_dependency_exceptions');
