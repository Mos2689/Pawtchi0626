# Rollback scripts

Hand-run teardowns, one per migration that is worth being able to undo.

**Nothing in this directory is a migration.** It sits outside `supabase/migrations/`
precisely so `supabase db push` and `supabase db reset` can never execute it. A
file here only runs when someone deliberately runs it.

## Why these exist

This project has no staging database and no dev branches, so migrations are
applied straight to production. That is survivable for additive changes, but it
means "undo" has to be something you already wrote, not something you improvise
at the moment you need it. The teardown is written **before** the migration is
applied, while the full inventory of what it creates is still fresh.

## Naming

Mirror the migration, with a `_down` suffix:

```
supabase/migrations/20260917000000_community_walks.sql
supabase/rollback/20260917000000_community_walks_down.sql
```

## What a teardown should do

1. **Be transactional.** One `BEGIN`/`COMMIT`, so a failure reverts nothing
   rather than half of it.
2. **Be idempotent.** `IF EXISTS` on every statement, so running it twice is
   not an error.
3. **Drop in dependency order.** Policies before the functions and tables they
   reference. Prefer naming each object over relying on `CASCADE`, so nothing
   disappears invisibly.
4. **Separate schema from data.** Reversing a schema is not a licence to delete
   what users put into it. Anything that destroys real data — a column people
   filled in, a storage bucket holding their photos — belongs in a clearly
   marked section that is commented out by default.
5. **Name any consumer outside the database.** Edge functions and app builds
   are not covered by SQL. Say whether they need redeploying, and in what
   order.
6. **End with a verification query.** A short `SELECT` that returns zeroes when
   the teardown is complete, so "did it work" is not a matter of opinion.

## What a teardown cannot do

- **Storage files.** Deleting `storage.objects` rows removes Postgres's record,
  not the files. Emptying a bucket needs the Storage API or the dashboard.
- **Data already gone.** A teardown reverses structure. If a migration
  backfilled or rewrote a column, restoring the old values is a restore from
  backup, not a rollback — note that in the file rather than implying otherwise.
