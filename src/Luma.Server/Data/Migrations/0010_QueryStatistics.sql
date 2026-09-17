-- Newly added indexes must have the same statistics as existing indexes.
-- Otherwise SQLite can mistake a new availability index for a selective scan
-- and sort the entire library instead of seeking an established sort index.
ANALYZE Media;
