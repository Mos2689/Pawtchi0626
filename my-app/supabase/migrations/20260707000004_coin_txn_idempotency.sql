-- Idempotent coin awards.
--
-- Tracked walks sync offline sessions with retries, so the same completion
-- can reach update-streak more than once. The function now pre-checks the
-- ledger for (owner_id, reason, reference_id); this unique index is the
-- belt-and-braces guard underneath it.
--
-- The ledger is not user-facing (only update-streak writes it) and balances
-- are denormalized into streaks.paw_coins, so trimming historical duplicate
-- rows (from old optimistic-retry paths) does not change anyone's balance.
-- Keep the earliest row of each duplicate group.

DELETE FROM coin_transactions a
USING coin_transactions b
WHERE a.reference_id IS NOT NULL
  AND a.owner_id = b.owner_id
  AND a.reason = b.reason
  AND a.reference_id = b.reference_id
  AND a.ctid > b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_coin_txn_reference
  ON coin_transactions (owner_id, reason, reference_id)
  WHERE reference_id IS NOT NULL;
