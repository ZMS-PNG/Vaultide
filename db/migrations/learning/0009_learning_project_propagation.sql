ALTER TABLE learning_sprints
  ADD COLUMN IF NOT EXISTS project_id text;

ALTER TABLE learning_sprints
  ADD COLUMN IF NOT EXISTS project_revision bigint;

ALTER TABLE learning_sprints
  ADD CONSTRAINT learning_sprints_project_revision_check CHECK (
    project_revision IS NULL OR project_revision >= 1
  );

ALTER TABLE learning_sprints
  ADD CONSTRAINT learning_sprints_project_fk
  FOREIGN KEY (owner_id, project_id)
  REFERENCES learning_projects(owner_id, id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS learning_sprints_project_updated_idx
  ON learning_sprints(owner_id, project_id, updated_at DESC, id)
  WHERE project_id IS NOT NULL;

ALTER TABLE research_runs
  ADD COLUMN IF NOT EXISTS project_id text;

ALTER TABLE research_runs
  ADD CONSTRAINT research_runs_project_fk
  FOREIGN KEY (owner_id, project_id)
  REFERENCES learning_projects(owner_id, id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS research_runs_project_created_idx
  ON research_runs(owner_id, project_id, created_at DESC, id)
  WHERE project_id IS NOT NULL;

ALTER TABLE synthesis_runs
  ADD COLUMN IF NOT EXISTS project_id text;

ALTER TABLE synthesis_runs
  ADD CONSTRAINT synthesis_runs_project_fk
  FOREIGN KEY (owner_id, project_id)
  REFERENCES learning_projects(owner_id, id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS synthesis_runs_project_created_idx
  ON synthesis_runs(owner_id, project_id, created_at DESC, id)
  WHERE project_id IS NOT NULL;
