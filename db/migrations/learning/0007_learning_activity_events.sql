ALTER TABLE learning_events
  DROP CONSTRAINT IF EXISTS learning_events_event_type_check;

ALTER TABLE learning_events
  ADD CONSTRAINT learning_events_event_type_check CHECK (event_type IN (
    'diagnosisAnswered', 'retrievalAttempted', 'hintRequested', 'answerRevealed',
    'explanationSubmitted', 'practiceSubmitted', 'sceneViewed',
    'whiteboardNoteAdded', 'discussionParticipated', 'feedbackReceived',
    'evidenceSubmitted', 'evidenceEvaluated', 'transferTaskCompleted',
    'writebackApproved', 'writebackApplied', 'reviewCompleted'
  ));
