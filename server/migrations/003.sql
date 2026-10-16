-- Revision zero means preferences have never been saved by this learner.
-- Adopt the new light default only for untouched legacy defaults. Preserve
-- every explicit/customized preference, all accounts and all saved work.
-- Advance the revision so an already-open stale settings form cannot overwrite it.
UPDATE learner
SET preferences=json_set(preferences, '$.theme', 'light'),
    preferences_revision=preferences_revision+1
WHERE preferences_revision=0 AND json_extract(preferences, '$.theme')='dark';
