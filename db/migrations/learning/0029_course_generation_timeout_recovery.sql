SET LOCAL lock_timeout = '5s';

ALTER TABLE course_generation_steps
  DROP CONSTRAINT IF EXISTS course_generation_steps_max_attempts_check;

ALTER TABLE course_generation_steps
  ADD CONSTRAINT course_generation_steps_max_attempts_check
  CHECK (max_attempts BETWEEN 1 AND 15) NOT VALID;

ALTER TABLE course_generation_steps
  VALIDATE CONSTRAINT course_generation_steps_max_attempts_check;
