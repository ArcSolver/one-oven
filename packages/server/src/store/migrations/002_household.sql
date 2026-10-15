CREATE TABLE households(id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
INSERT INTO households VALUES ('local', 0);
ALTER TABLE kitchens ADD COLUMN household_id TEXT NOT NULL DEFAULT 'local';
ALTER TABLE kitchens ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE plans ADD COLUMN household_id TEXT NOT NULL DEFAULT 'local';
ALTER TABLE plans ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE plans ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
CREATE TABLE plan_events(plan_id TEXT NOT NULL REFERENCES plans(id), version INTEGER NOT NULL,
  tool TEXT NOT NULL, request_key TEXT, changes TEXT NOT NULL, at INTEGER NOT NULL,
  PRIMARY KEY(plan_id, version));
CREATE TABLE idempotency(request_key TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id),
  tool TEXT NOT NULL, args_hash TEXT NOT NULL, plan_id TEXT, result_version INTEGER,
  response TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX idem_recent ON idempotency(household_id, tool, args_hash, created_at);
CREATE INDEX plans_household ON plans(household_id, id);
CREATE INDEX kitchens_household ON kitchens(household_id, id);
