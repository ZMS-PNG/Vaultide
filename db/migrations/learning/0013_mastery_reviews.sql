-- Adds the completion semantics introduced by learning-event/1 without
-- rewriting historical events. Passive scene views remain valid but are never
-- used as mastery evidence by the mastery-evidence-v2 projector.
ALTER TABLE learning_events
  DROP CONSTRAINT IF EXISTS learning_events_event_type_check;

ALTER TABLE learning_events
  ADD CONSTRAINT learning_events_event_type_check CHECK (event_type IN (
    'diagnosisAnswered', 'retrievalAttempted', 'hintRequested', 'answerRevealed',
    'explanationSubmitted', 'practiceSubmitted', 'sceneViewed', 'sceneCompleted',
    'sprintCompleted', 'whiteboardNoteAdded', 'discussionParticipated',
    'feedbackReceived', 'evidenceSubmitted', 'evidenceEvaluated',
    'transferTaskCompleted', 'writebackApproved', 'writebackApplied', 'reviewCompleted'
  ));

CREATE TABLE IF NOT EXISTS mastery_projections (
  id text PRIMARY KEY CHECK (id ~ '^mpr_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  sprint_id text NOT NULL,
  concept_id text NOT NULL CHECK (char_length(concept_id) BETWEEN 1 AND 256),
  estimate numeric(6,5) CHECK (estimate IS NULL OR (estimate >= 0 AND estimate <= 1)),
  confidence numeric(6,5) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  evidence_count integer NOT NULL CHECK (evidence_count >= 0),
  evidence_types jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_types) = 'array'),
  evidence_summary jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_summary) = 'array'),
  last_practiced_at timestamptz,
  next_review_at timestamptz,
  projector_version text NOT NULL CHECK (char_length(projector_version) BETWEEN 1 AND 128),
  computed_at timestamptz NOT NULL,
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, sprint_id, concept_id, projector_version),
  FOREIGN KEY (owner_id, sprint_id)
    REFERENCES learning_sprints(owner_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS mastery_projections_owner_sprint_computed_idx
  ON mastery_projections(owner_id, sprint_id, computed_at DESC);

CREATE INDEX IF NOT EXISTS mastery_projections_owner_due_idx
  ON mastery_projections(owner_id, next_review_at)
  WHERE next_review_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS review_items (
  id text PRIMARY KEY CHECK (id ~ '^rvi_[a-f0-9]{32}$'),
  owner_id text NOT NULL REFERENCES learning_owners(id) ON DELETE RESTRICT,
  sprint_id text NOT NULL,
  concept_id text NOT NULL CHECK (char_length(concept_id) BETWEEN 1 AND 256),
  projector_version text NOT NULL CHECK (char_length(projector_version) BETWEEN 1 AND 128),
  state text NOT NULL CHECK (state IN ('scheduled', 'due', 'completed', 'cancelled')),
  due_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, sprint_id, concept_id, projector_version),
  FOREIGN KEY (owner_id, sprint_id)
    REFERENCES learning_sprints(owner_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS review_items_owner_state_due_idx
  ON review_items(owner_id, state, due_at);
