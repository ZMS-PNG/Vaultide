-- A synthesis index may be updated unattended only after its first
-- user-confirmed creation. The local connector still enforces the dedicated
-- path, managed identity, block hashes, and compare-and-swap replacement.
ALTER TABLE deposition_policies
  ADD COLUMN IF NOT EXISTS allow_synthesis_index_updates boolean NOT NULL DEFAULT false;
