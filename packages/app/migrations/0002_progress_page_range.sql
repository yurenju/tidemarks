-- What the reader could see, not just where they were (#63).
--
-- `cfi` is a point; a page is a stretch, and a stretch is a product of layout, so only the
-- device that rendered it knows where it ended. The MCP server reads this to answer "explain
-- the passage I am looking at" — without it the Worker can say where the reader is and not
-- what was on screen.
--
-- Nullable, because it genuinely is absent sometimes: a full-page image holds no characters,
-- and every row written before this column existed has no answer either.
ALTER TABLE progress ADD COLUMN page_range TEXT;
