-- Keep the immutable owner on deposition history when a transient learning
-- sprint is deleted. PostgreSQL's unqualified SET NULL applies to every
-- referencing column in a composite key, which violates owner_id NOT NULL.
ALTER TABLE deposition_runs
  DROP CONSTRAINT IF EXISTS deposition_runs_owner_id_sprint_id_fkey;

ALTER TABLE deposition_runs
  ADD CONSTRAINT deposition_runs_owner_id_sprint_id_fkey
  FOREIGN KEY (owner_id, sprint_id)
  REFERENCES learning_sprints(owner_id, id)
  ON DELETE SET NULL (sprint_id);
