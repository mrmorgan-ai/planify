-- Hours already spent on an item, declared by hand.
--
-- Three states answer "is it finished?" but not "how far in am I?", and a week's
-- capacity is spent in hours, not in items. Progress is kept here rather than
-- derived from the state so that the board can show a 4h item as half done
-- without pretending it is finished.
--
-- Progress, like state and the projections, is never written by a seed load.

ALTER TABLE items ADD COLUMN hours_done REAL NOT NULL DEFAULT 0;
