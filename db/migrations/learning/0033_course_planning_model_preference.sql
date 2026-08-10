-- A durable course workflow must retain the learner's selected model after
-- the browser request ends.  This stores only a non-secret provider/model
-- selector and optional thinking mode: credentials and custom endpoints stay
-- in the server-side provider configuration.

ALTER TABLE course_planning_runs
  ADD COLUMN IF NOT EXISTS generation_model_json jsonb;

ALTER TABLE course_planning_runs
  DROP CONSTRAINT IF EXISTS course_planning_runs_generation_model_json_check;

ALTER TABLE course_planning_runs
  ADD CONSTRAINT course_planning_runs_generation_model_json_check CHECK (
    generation_model_json IS NULL
    OR (
      jsonb_typeof(generation_model_json) = 'object'
      AND jsonb_typeof(generation_model_json -> 'modelString') = 'string'
      AND char_length(generation_model_json ->> 'modelString') BETWEEN 3 AND 256
    )
  );
