# Live Walk v2: concurrency checks (two sessions)

`live_walk_v2.test.sql` runs inside one transaction, so it can't show two people acting at the same moment. These three checks need two `psql` sessions, A and B, connected to a **branch** database. Never run them against production.

## Setup (in either session)

Fixtures:
- `host` and `friend` are pack members;
- walk `w` is `active`;
- both are `walking` with `share_location = true`;
- there are no `private.live_sessions` rows for them yet.

In each session, act as a user like this:

```sql
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', '<user id>')::text, false);
```

## 1. Close versus publish

The host's walk closes while a walker's write is in flight. The write must either land before the close, in which case the close's cleanup removes it, or be refused after it. It must never be left behind.

| Step | A (walker) | B (host) |
|---|---|---|
| 1 | `BEGIN; SELECT begin_live_session('<w>', gen_random_uuid());` and commit. Note the `gen`. | |
| 2 | `BEGIN; SELECT publish_live_location('<w>', <gen>, 1, 1, 1, 5, 0, NULL, now(), 1, '[]');`. Leave it **open**. | |
| 3 | | `UPDATE community_walks SET state = 'completed' WHERE id = '<w>';` → this **waits** (A holds the walk `FOR SHARE`). |
| 4 | `COMMIT;` | The update finishes. |
| 5 | | `SELECT count(*) FROM community_live_locations WHERE walk_id = '<w>';` → **0** |

Reverse order: B runs `BEGIN; UPDATE … 'completed'` without committing. A's publish then waits. B commits. A returns `walk_closed`, and the count is still 0.

## 2. Two first acquisitions at once

No session row exists yet. Both calls are for the same user, with different tokens.

| Step | A | B |
|---|---|---|
| 1 | `BEGIN; SELECT begin_live_session('<w>', '<token 1>');` → `gen` 1, still open | |
| 2 | | `BEGIN; SELECT begin_live_session('<w>', '<token 2>');` → **waits** |
| 3 | `COMMIT;` | Returns `gen` **2**. `COMMIT;` |
| 4 | `SELECT begin_live_session('<w>', '<token 1>');` → `superseded`, gen 2 | |

Expected: exactly one increment each, in order. No error, and no gap in the generations.

## 3. The same start retried while the first is still in flight

| Step | A | B |
|---|---|---|
| 1 | `BEGIN; SELECT begin_live_session('<w>', '<token 3>');` still open | |
| 2 | | `SELECT begin_live_session('<w>', '<token 3>');` → **waits** |
| 3 | `COMMIT;` | Returns the **same** `gen` with `ok`. |

Record the outputs of all three in the release notes. Gate 2 of the plan needs them.
