-- What the shelf needs to say how much longer a book has in it (#129).
--
-- Two facts, and both are only knowable on the device that had the book open. A sitting's
-- duration is on `reading_sessions` already; a duration is not a reading speed, so each sitting
-- now also carries where in the book it began and ended. And the chapter: naming it means the
-- table of contents and the section boundaries, which means opening the epub — the shelf would
-- have to open twenty of them to draw one screen, and the reader had the book open anyway.
--
-- All three are nullable, because they genuinely are absent sometimes: a sitting the device
-- could not place (frond reports no fraction until the whole-book index is built), and every
-- row written before these columns existed.
ALTER TABLE reading_sessions ADD COLUMN start_fraction REAL;
ALTER TABLE reading_sessions ADD COLUMN end_fraction REAL;
ALTER TABLE progress ADD COLUMN chapter_label TEXT;
