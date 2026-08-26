-- When the shelf's revisit card last put a passage in front of the reader.
--
-- It syncs because "I have seen this one" is a fact about the reader, not about the machine
-- they happened to be holding — the same reasoning as a reading position. Nullable with no
-- default: every row that predates this column has genuinely never reached the card, and the
-- client reads a null as the front of the queue rather than the back.
--
-- No index. The client sorts the whole list in memory (it already loads every annotation to
-- draw the shelf), and the server never orders by this column — it only carries it.
ALTER TABLE annotations ADD COLUMN last_shown_at INTEGER;
