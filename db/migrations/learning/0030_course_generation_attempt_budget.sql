SET LOCAL lock_timeout = '5s';

ALTER TABLE course_generation_steps
  DROP CONSTRAINT IF EXISTS course_generation_steps_attempt_count_check;

ALTER TABLE course_generation_steps
  ADD CONSTRAINT course_generation_steps_attempt_count_check
  CHECK (attempt_count BETWEEN 0 AND 15) NOT VALID;

ALTER TABLE course_generation_steps
  VALIDATE CONSTRAINT course_generation_steps_attempt_count_check;

ALTER TABLE course_generation_attempts
  DROP CONSTRAINT IF EXISTS course_generation_attempts_attempt_no_check;

ALTER TABLE course_generation_attempts
  ADD CONSTRAINT course_generation_attempts_attempt_no_check
  CHECK (attempt_no BETWEEN 1 AND 15) NOT VALID;

ALTER TABLE course_generation_attempts
  VALIDATE CONSTRAINT course_generation_attempts_attempt_no_check;
