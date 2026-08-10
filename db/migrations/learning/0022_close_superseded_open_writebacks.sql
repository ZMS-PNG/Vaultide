-- An old retry can remain generated even though another draft for the same
-- sprint was already applied. It is no longer actionable and must not block a
-- fresh companion/update draft.
UPDATE writeback_drafts open_draft
SET status = 'expired',
    updated_at = now()
WHERE open_draft.sprint_id IS NOT NULL
  AND open_draft.status IN ('generated', 'edited', 'approved')
  AND EXISTS (
    SELECT 1
    FROM writeback_drafts applied_draft
    WHERE applied_draft.owner_id = open_draft.owner_id
      AND applied_draft.sprint_id = open_draft.sprint_id
      AND applied_draft.draft_kind = open_draft.draft_kind
      AND applied_draft.id <> open_draft.id
      AND applied_draft.status = 'applied'
  );

UPDATE writeback_commands command
SET status = 'expired',
    lease_until = NULL,
    updated_at = now()
FROM writeback_drafts draft
WHERE draft.id = command.draft_id
  AND draft.status = 'expired'
  AND command.status IN ('pending', 'leased');
