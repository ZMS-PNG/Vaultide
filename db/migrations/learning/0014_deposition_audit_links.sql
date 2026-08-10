-- A deposition run must be traceable all the way to the exact draft,
-- command, local safety check, and receipt that carried it.  This migration is
-- additive because 0012 has already been applied in production.
ALTER TABLE deposition_items
  ADD COLUMN IF NOT EXISTS writeback_draft_id text
    REFERENCES writeback_drafts(id) ON DELETE SET NULL;

ALTER TABLE deposition_items
  ADD COLUMN IF NOT EXISTS writeback_command_id text
    REFERENCES writeback_commands(id) ON DELETE SET NULL;

ALTER TABLE deposition_items
  ADD COLUMN IF NOT EXISTS receipt_id text
    REFERENCES writeback_receipts(id) ON DELETE SET NULL;

ALTER TABLE deposition_items
  DROP CONSTRAINT IF EXISTS deposition_items_state_check;

ALTER TABLE deposition_items
  ADD CONSTRAINT deposition_items_state_check
  CHECK (state IN (
    'pending', 'generated', 'queued', 'leased', 'locally_validated',
    'applied', 'receipted', 'conflicted', 'expired', 'rejected', 'failed',
    'skipped'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS deposition_items_command_unique_idx
  ON deposition_items(writeback_command_id)
  WHERE writeback_command_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS deposition_items_draft_idx
  ON deposition_items(owner_id, writeback_draft_id)
  WHERE writeback_draft_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS deposition_items_command_idx
  ON deposition_items(owner_id, writeback_command_id)
  WHERE writeback_command_id IS NOT NULL;
