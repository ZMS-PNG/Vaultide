ALTER TABLE research_runs
  DROP CONSTRAINT IF EXISTS research_runs_provider_mode_check;

ALTER TABLE research_runs
  ADD CONSTRAINT research_runs_provider_mode_check
  CHECK (provider_mode IN ('official-api', 'self-hosted', 'public-page', 'direct-url'));
