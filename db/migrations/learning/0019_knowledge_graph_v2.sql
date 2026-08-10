-- Knowledge graph v2 stores explainable, rebuildable projections. Source
-- facts remain in their existing tables; this migration never grants the web
-- application filesystem access and never makes original notes writable.
CREATE TABLE IF NOT EXISTS knowledge_concepts (
  id text PRIMARY KEY CHECK (id ~ '^kgc_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  canonical_key text NOT NULL CHECK (canonical_key ~ '^[a-f0-9]{64}$'),
  canonical_label text NOT NULL CHECK (char_length(canonical_label) BETWEEN 1 AND 300),
  normalized_label text NOT NULL CHECK (char_length(normalized_label) BETWEEN 1 AND 300),
  domain_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(domain_ids) = 'array'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'merged', 'archived')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, canonical_key)
);

CREATE INDEX IF NOT EXISTS knowledge_concepts_owner_label_idx
  ON knowledge_concepts(owner_id, normalized_label);

CREATE TABLE IF NOT EXISTS knowledge_concept_aliases (
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  concept_id text NOT NULL,
  alias text NOT NULL CHECK (char_length(alias) BETWEEN 1 AND 300),
  normalized_alias text NOT NULL CHECK (char_length(normalized_alias) BETWEEN 1 AND 300),
  origin text NOT NULL CHECK (origin IN ('canonical', 'source', 'model', 'manual')),
  confidence numeric(6,5) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, concept_id, normalized_alias),
  FOREIGN KEY (owner_id, concept_id)
    REFERENCES knowledge_concepts(owner_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS knowledge_relations (
  id text PRIMARY KEY CHECK (id ~ '^kgr_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  source_node_id text NOT NULL CHECK (char_length(source_node_id) BETWEEN 1 AND 320),
  target_node_id text NOT NULL CHECK (char_length(target_node_id) BETWEEN 1 AND 320),
  relation_type text NOT NULL CHECK (relation_type IN (
    'belongs-to', 'contains', 'cites', 'derived-from', 'companion-of',
    'precedes', 'prerequisite', 'supports', 'contradicts', 'applies-to',
    'related-to', 'review-of'
  )),
  directed boolean NOT NULL,
  weight numeric(7,6) NOT NULL CHECK (weight >= 0 AND weight <= 1),
  confidence numeric(7,6) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  origin text NOT NULL CHECK (origin IN ('deterministic', 'lexical', 'embedding', 'llm', 'manual')),
  generator_version text NOT NULL CHECK (char_length(generator_version) BETWEEN 1 AND 128),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'candidate', 'confirmed', 'rejected')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (owner_id, id),
  CHECK (source_node_id <> target_node_id),
  CHECK (
    origin = 'deterministic'
    OR relation_type NOT IN ('contradicts', 'prerequisite')
    OR status = 'confirmed'
  )
);

CREATE INDEX IF NOT EXISTS knowledge_relations_owner_source_idx
  ON knowledge_relations(owner_id, source_node_id, relation_type);

CREATE INDEX IF NOT EXISTS knowledge_relations_owner_target_idx
  ON knowledge_relations(owner_id, target_node_id, relation_type);

CREATE TABLE IF NOT EXISTS knowledge_graph_projections (
  id text PRIMARY KEY CHECK (id ~ '^kgp_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  synthesis_id text NOT NULL,
  scope_hash text NOT NULL CHECK (scope_hash ~ '^[a-f0-9]{64}$'),
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  graph_hash text CHECK (graph_hash IS NULL OR graph_hash ~ '^[a-f0-9]{64}$'),
  projector_version text NOT NULL CHECK (char_length(projector_version) BETWEEN 1 AND 128),
  layout_version text NOT NULL CHECK (char_length(layout_version) BETWEEN 1 AND 128),
  status text NOT NULL CHECK (status IN ('building', 'ready', 'failed')),
  graph_snapshot jsonb CHECK (
    graph_snapshot IS NULL OR jsonb_typeof(graph_snapshot) = 'object'
  ),
  node_count integer NOT NULL DEFAULT 0 CHECK (node_count BETWEEN 0 AND 100000),
  edge_count integer NOT NULL DEFAULT 0 CHECK (edge_count BETWEEN 0 AND 500000),
  failure_detail text CHECK (failure_detail IS NULL OR char_length(failure_detail) <= 2000),
  generated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (owner_id, id),
  UNIQUE (
    owner_id, synthesis_id, input_hash, projector_version, layout_version
  ),
  FOREIGN KEY (owner_id, synthesis_id)
    REFERENCES synthesis_runs(owner_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS knowledge_graph_projections_owner_created_idx
  ON knowledge_graph_projections(owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS knowledge_graph_projections_ready_synthesis_idx
  ON knowledge_graph_projections(owner_id, synthesis_id, created_at DESC)
  WHERE status = 'ready';

CREATE TABLE IF NOT EXISTS knowledge_evidence_refs (
  id text PRIMARY KEY CHECK (id ~ '^kge_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  projection_id text NOT NULL,
  relation_id text,
  evidence_kind text NOT NULL CHECK (evidence_kind IN (
    'source-version', 'classroom', 'learning-event', 'mastery-projection',
    'companion-binding', 'review-item', 'synthesis', 'lexical-comparison',
    'manual-feedback'
  )),
  entity_id text NOT NULL CHECK (char_length(entity_id) BETWEEN 1 AND 320),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 500),
  locator jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(locator) = 'object'),
  occurred_at timestamptz,
  created_at timestamptz NOT NULL,
  UNIQUE (owner_id, id),
  FOREIGN KEY (owner_id, projection_id)
    REFERENCES knowledge_graph_projections(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, relation_id)
    REFERENCES knowledge_relations(owner_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS knowledge_evidence_refs_relation_idx
  ON knowledge_evidence_refs(owner_id, relation_id);

CREATE INDEX IF NOT EXISTS knowledge_evidence_refs_entity_idx
  ON knowledge_evidence_refs(owner_id, evidence_kind, entity_id);

CREATE TABLE IF NOT EXISTS knowledge_graph_projection_nodes (
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  projection_id text NOT NULL,
  node_id text NOT NULL CHECK (char_length(node_id) BETWEEN 1 AND 320),
  canonical_id text NOT NULL CHECK (char_length(canonical_id) BETWEEN 1 AND 320),
  node_type text NOT NULL CHECK (node_type IN (
    'project', 'original-note', 'companion-note', 'external-source',
    'classroom', 'concept', 'claim', 'skill', 'artifact', 'review'
  )),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, projection_id, node_id),
  FOREIGN KEY (owner_id, projection_id)
    REFERENCES knowledge_graph_projections(owner_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS knowledge_graph_projection_nodes_canonical_idx
  ON knowledge_graph_projection_nodes(owner_id, canonical_id, projection_id);

CREATE INDEX IF NOT EXISTS knowledge_graph_projection_nodes_type_idx
  ON knowledge_graph_projection_nodes(owner_id, projection_id, node_type);

CREATE TABLE IF NOT EXISTS knowledge_graph_projection_edges (
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  projection_id text NOT NULL,
  edge_id text NOT NULL CHECK (edge_id ~ '^kgr_[a-f0-9]{32}$'),
  relation_id text NOT NULL,
  source_node_id text NOT NULL CHECK (char_length(source_node_id) BETWEEN 1 AND 320),
  target_node_id text NOT NULL CHECK (char_length(target_node_id) BETWEEN 1 AND 320),
  edge_type text NOT NULL CHECK (edge_type IN (
    'belongs-to', 'contains', 'cites', 'derived-from', 'companion-of',
    'precedes', 'prerequisite', 'supports', 'contradicts', 'applies-to',
    'related-to', 'review-of'
  )),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, projection_id, edge_id),
  FOREIGN KEY (owner_id, projection_id)
    REFERENCES knowledge_graph_projections(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, relation_id)
    REFERENCES knowledge_relations(owner_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS knowledge_graph_projection_edges_source_idx
  ON knowledge_graph_projection_edges(owner_id, projection_id, source_node_id);

CREATE INDEX IF NOT EXISTS knowledge_graph_projection_edges_target_idx
  ON knowledge_graph_projection_edges(owner_id, projection_id, target_node_id);

CREATE TABLE IF NOT EXISTS knowledge_relation_feedback (
  id text PRIMARY KEY CHECK (id ~ '^kgf_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  relation_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('confirm', 'reject')),
  reason text CHECK (reason IS NULL OR char_length(reason) <= 2000),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, relation_id),
  FOREIGN KEY (owner_id, relation_id)
    REFERENCES knowledge_relations(owner_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS knowledge_relation_feedback_owner_updated_idx
  ON knowledge_relation_feedback(owner_id, updated_at DESC);
