-- Migrations 0010 and 0011 analysed Media to give its indexes comparable statistics, but on a
-- fresh install they run before anything is indexed, so sqlite_stat1 records an empty table and
-- stays that way for the life of the install. The planner then costs every browse query against
-- zero rows and walks the library where it should seek a sort index -- cheap while the pages are
-- cached, minutes when they have to come off a sleeping disk.
-- analysis_limit samples each index instead of reading it whole, so this stays bounded on a
-- library of any size. ScanWorker repeats it whenever the recorded count drifts from the real one.
PRAGMA analysis_limit=400;
ANALYZE Media;
