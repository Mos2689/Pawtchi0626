# Salty Dog Social (Sat 17 Oct 2026) — runbook

Three things, in this order: the community link, Broadcast, the load test.
Everything here is server-side or a script; no new app build.

---

## 1. Community link (reusable invite)

Ships in migration `20261008000000_reusable_invite_links.sql` (branch
`feat/community-link`). Push it with `supabase db push` as usual. Rollback:
`supabase/rollbacks/20261008000000_reusable_invite_links.down.sql`.

1. Salty Dog Club (the host account) creates the meetup in Pawtchi and plans
   the walk (Sat 17 Oct, 8:30 am, Red Horse Coffee Co).
2. The host taps **Invite → share link** once and sends you that link. The code
   is the part after `code=`.
3. In the Supabase SQL editor:
   ```sql
   SELECT private.make_community_link('<code>'::uuid, '2026-10-18 00:00+10', 500);
   ```
   It returns the link to post. `500` is an optional cap on how many people can
   ask; leave it out for no cap. The link must expire within 31 days.
4. Salty Dog Club posts the link. Everyone who opens it asks to join; the host
   gets a push for each and confirms them on the meetup page.
5. To close it (new people are refused, waiting requests stay with the host):
   ```sql
   SELECT private.end_community_link('<code>'::uuid);
   ```

How many have asked / been confirmed:
```sql
SELECT c.state, count(*) FROM community_pack_invitations c
JOIN community_pack_invitations l ON l.id = c.parent_invite_id
WHERE l.invite_code = '<code>'::uuid GROUP BY c.state;
```

---

## 2. Broadcast for the event walk

**What decides it:** when the host taps start, the walk becomes `broadcast` only
if (a) the server switch is on **and** (b) the host's phone has the PostHog flag
`live-walk-broadcast` (with `live-walk-v2`). Everyone who joins follows the walk.
Walks started by anyone without the flag stay `db`, so the switch is safe to
leave on while the flag is targeted.

### Turn it on
1. PostHog → feature flag `live-walk-broadcast` → release condition: **your
   tester accounts only** (by email / distinct id). `live-walk-v2` stays at 100 %.
2. SQL editor:
   ```sql
   UPDATE private.live_settings SET broadcast_enabled = true, updated_at = now();
   ```
3. Fully close and reopen the app on the host phone — flags are read once per
   session.

### Test it (2–3 phones, ~20 min)
1. Host (flag on) starts a test meetup walk. Confirm:
   ```sql
   SELECT id, title, live_transport FROM community_walks WHERE state = 'active';
   ```
   → `broadcast`. If `db`: the flag hadn't reached the phone (reopen the app) or
   the switch is off.
2. Two other phones join. Walk around for 10 min. Check:
   - every dog moves on every phone roughly every 10 s;
   - lock one phone while walking for 3–5 min — it keeps moving on the others;
   - leave one phone stationary and locked — it should stay visible ~2 min
     after it goes quiet, then hide (known limit).
3. Host finishes the walk. In PostHog, the `live_walk_sender_summary` events for
   that walk should show `transport: broadcast`, `pos_sent` ≈ minutes × 6,
   `rpc_ok` ≈ minutes × 1, `rpc_failed` 0. `live_walk_viewer_summary` should show
   `messages` > 0, `room_drops` low (0–2), `reads_failed` 0.
4. Database side: calls to `publish_live_location` drop from ~5/min per walker
   (db) to ~1/min (broadcast). Supabase → Logs → API, filter `publish_live_location`.

### For the event
Add the **Salty Dog Club host account** to the `live-walk-broadcast` release
condition. Only the host's phone matters.

### Turn it off
- New walks: `UPDATE private.live_settings SET broadcast_enabled = false, updated_at = now();`
- Walks already running (they switch within ~30 s):
  `UPDATE community_walks SET live_transport = 'db' WHERE state = 'active';`

---

## 3. Load test (before the event)

Production is shared with real people, so: run it **late at night AEST**, ramp
up, and let the script's auto-abort do its job (it stops if RPC p95 > 3 s or
errors > 5 % over a minute).

1. **A load-test meetup.** On your tester phone, create a meetup named
   `Load test` and plan a walk titled `Load test walk` (the scripts refuse
   anything not named "Load test…"). Copy its ids:
   ```sql
   SELECT p.id AS pack, w.id AS walk, w.title FROM community_packs p
   JOIN community_walks w ON w.pack_id = p.id WHERE p.name ILIKE 'load test%';
   ```
2. **Test accounts** (service-role key only in the environment, for this one
   command; run from `my-app/`):
   ```bash
   SUPABASE_SERVICE_ROLE_KEY=… node scripts/load/setup-test-accounts.mjs --create 60 --pack <pack>
   ```
3. **Start the walk** from the tester phone (with `live-walk-broadcast` on to
   test Broadcast, or off to test `db`). Keep the live map open on that phone —
   you will see the simulated dogs wander near Miami, QLD.
4. **Ramp:**
   ```bash
   node scripts/load/live-walk-load.mjs --walk <walk> --phones 10 --minutes 5 --ramp 30
   node scripts/load/live-walk-load.mjs --walk <walk> --phones 30 --minutes 10 --ramp 60
   node scripts/load/live-walk-load.mjs --walk <walk> --phones 60 --minutes 10 --ramp 120
   ```
   Each run prints a line every 15 s and writes `scripts/load/report-*.json`.
   Run the same steps once with a `db` walk and once with a `broadcast` walk —
   the comparison is the point.
5. **Watch at the same time:** Supabase → Reports (CPU, connections), Realtime
   → usage (concurrent connections, messages/s — check them against your plan's
   Realtime limits), Logs → API (5xx, PGRST002/003).
6. **Pass:** `publish_live_location` and `live_walk_positions` p95 under 1 s,
   errors 0, no Realtime quota warnings, the live map on the tester phone stays
   smooth, and real users' requests stay normal in the API logs.
7. **Clean up:**
   ```bash
   SUPABASE_SERVICE_ROLE_KEY=… node scripts/load/setup-test-accounts.mjs --delete
   ```
   then finish the load-test walk on the tester phone.

Send me the report files and I'll read them with you.
