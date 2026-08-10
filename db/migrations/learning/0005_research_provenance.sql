CREATE TABLE IF NOT EXISTS research_runs (
  id text PRIMARY KEY CHECK (id ~ '^rrn_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  requested_provider text NOT NULL CHECK (char_length(requested_provider) BETWEEN 2 AND 40),
  used_provider text NOT NULL CHECK (char_length(used_provider) BETWEEN 2 AND 40),
  provider_mode text NOT NULL CHECK (
    provider_mode IN ('official-api', 'self-hosted', 'public-page')
  ),
  query text NOT NULL CHECK (char_length(query) BETWEEN 1 AND 1000),
  source_policy text NOT NULL CHECK (source_policy IN ('balanced', 'prefer-primary')),
  storage_policy text NOT NULL CHECK (storage_policy = 'citation-metadata-only'),
  attempts jsonb NOT NULL CHECK (jsonb_typeof(attempts) = 'array'),
  source_count integer NOT NULL CHECK (source_count BETWEEN 1 AND 50),
  response_time_ms integer NOT NULL CHECK (response_time_ms >= 0),
  fetched_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (owner_id, id)
);

CREATE INDEX IF NOT EXISTS research_runs_owner_fetched_idx
  ON research_runs(owner_id, fetched_at DESC);

CREATE TABLE IF NOT EXISTS research_sources (
  id text PRIMARY KEY CHECK (id ~ '^rsc_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  run_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 50),
  citation_id text NOT NULL CHECK (citation_id ~ '^S[1-9][0-9]?$'),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
  url text NOT NULL CHECK (char_length(url) BETWEEN 1 AND 4096),
  normalized_url text NOT NULL CHECK (char_length(normalized_url) BETWEEN 1 AND 4096),
  domain text NOT NULL CHECK (char_length(domain) BETWEEN 1 AND 253),
  snippet text NOT NULL CHECK (char_length(snippet) <= 1000),
  snippet_hash text NOT NULL CHECK (snippet_hash ~ '^[a-f0-9]{64}$'),
  score double precision NOT NULL,
  authority text NOT NULL CHECK (authority IN ('primary', 'authoritative', 'general')),
  created_at timestamptz NOT NULL,
  FOREIGN KEY (owner_id, run_id)
    REFERENCES research_runs(owner_id, id) ON DELETE CASCADE,
  UNIQUE (run_id, ordinal),
  UNIQUE (run_id, normalized_url)
);

CREATE INDEX IF NOT EXISTS research_sources_run_ordinal_idx
  ON research_sources(owner_id, run_id, ordinal);

ALTER TABLE learning_sprints
  ADD COLUMN IF NOT EXISTS research_run_id text;

ALTER TABLE learning_sprints
  ADD CONSTRAINT learning_sprints_research_run_fk
  FOREIGN KEY (owner_id, research_run_id)
  REFERENCES research_runs(owner_id, id) ON DELETE SET NULL;
