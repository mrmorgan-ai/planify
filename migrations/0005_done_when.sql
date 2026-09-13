-- What finishing an item produces, stated so it can be checked.
--
-- A practice block or an exam's preparation has no natural end the way a chapter
-- does, so without a stated outcome "done" means "I spent the hours". Kept apart
-- from `notes` so the board can show it on its own line without parsing prose.

ALTER TABLE items ADD COLUMN done_when TEXT NOT NULL DEFAULT '';
