-- Receipts are the durable truth for commands created before draft-status
-- projection was added. Backfill them before enforcing one open draft per
-- learning sprint and kind.
UPDATE writeback_drafts draft
SET status = receipt.outcome,
    updated_at = GREATEST(draft.updated_at, receipt.reported_at)
FROM writeback_commands command
JOIN writeback_receipts receipt ON receipt.command_id = command.id
WHERE draft.id = command.draft_id
  AND draft.revision = command.draft_revision
  AND draft.owner_id = command.owner_id
  AND draft.status IN ('generated', 'edited', 'approved');

-- Keep the newest still-open draft when historical retries created more than
-- one draft for the same learning sprint and asset kind.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY owner_id, sprint_id, draft_kind
           ORDER BY created_at DESC, id DESC
         ) AS position
  FROM writeback_drafts
  WHERE sprint_id IS NOT NULL
    AND status IN ('generated', 'edited', 'approved')
)
UPDATE writeback_drafts draft
SET status = 'expired',
    updated_at = now()
FROM ranked
WHERE draft.id = ranked.id
  AND ranked.position > 1;

UPDATE writeback_commands command
SET status = 'expired',
    lease_until = NULL,
    updated_at = now()
FROM writeback_drafts draft
WHERE draft.id = command.draft_id
  AND draft.status = 'expired'
  AND command.status IN ('pending', 'leased');

CREATE UNIQUE INDEX IF NOT EXISTS writeback_drafts_open_sprint_kind_uq
  ON writeback_drafts(owner_id, sprint_id, draft_kind)
  WHERE sprint_id IS NOT NULL
    AND status IN ('generated', 'edited', 'approved');
