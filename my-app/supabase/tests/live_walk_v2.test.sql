-- pgTAP suite for Live Walk v2, Phase 0a (20261004000000_live_walk_privacy_and_rpc).
--
-- Run against a BRANCH database, never production:
--   supabase db test --linked        (after `supabase branches create`)
-- or psql -f this file against a branch. Everything rolls back.
--
-- What it pins down:
--   1. THE PRIVACY BUG STAYS FIXED. Attending one active walk grants nothing on
--      another walk in the same pack: not reading, not writing.
--   2. ONE ISSUER OF GENERATIONS. begin_live_session is idempotent per token,
--      and a retry of an older token can never move the generation.
--   3. ORDERED WRITES. (gen, seq) decides; a superseded or older write never
--      replaces a newer one; a row without ordering metadata is taken over.
--   4. NO SENDER CLOCK IS TRUSTED. Ages in, server-derived times out.
--   5. VALIDATION. Out-of-range values and malformed routes are refused.
--   6. NO POSITION OUTLIVES ITS PERMISSION. Finishing, turning sharing off and
--      closing the walk remove positions.
--   7. GRANTS. anon reaches nothing; the session tables and refusal helper are
--      not reachable by signed-in users either.
--
-- Not covered here, because one transaction cannot show it: two sessions
-- racing (close versus publish, two first acquisitions). See
-- supabase/tests/live_walk_v2_concurrency.md.

BEGIN;
SELECT plan(61);

-- ── Fixtures ───────────────────────────────────────────────────────────────
CREATE TEMP TABLE t (k TEXT PRIMARY KEY, v UUID);
GRANT SELECT ON t TO authenticated, anon;

INSERT INTO t VALUES
  ('host',     gen_random_uuid()),  -- owner; walking and sharing on w1
  ('friend',   gen_random_uuid()),  -- walking and sharing on w1
  ('viewer',   gen_random_uuid()),  -- "coming" to w1, not sharing
  ('decliner', gen_random_uuid()),  -- can't make w1
  ('other',    gen_random_uuid()),  -- pack member walking on w2 ONLY
  ('stranger', gen_random_uuid()),  -- not in the pack
  ('pack',     gen_random_uuid()),
  ('w1',       gen_random_uuid()),
  ('w2',       gen_random_uuid()),
  ('tokA',     gen_random_uuid()),
  ('tokB',     gen_random_uuid()),
  ('tokF',     gen_random_uuid()),
  ('tokF2',    gen_random_uuid()),
  ('tokO',     gen_random_uuid());

CREATE FUNCTION pg_temp.id(p_key TEXT) RETURNS UUID
  LANGUAGE sql STABLE AS $$ SELECT v FROM t WHERE k = p_key $$;

CREATE FUNCTION pg_temp.act_as(p_key TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.id(p_key), 'role', 'authenticated')::TEXT, TRUE);
END;
$$;

CREATE FUNCTION pg_temp.begin(p_walk TEXT, p_token TEXT) RETURNS JSONB
  LANGUAGE sql AS $$ SELECT public.begin_live_session(pg_temp.id(p_walk), pg_temp.id(p_token)) $$;

CREATE FUNCTION pg_temp.pub(
  p_walk TEXT, p_gen INTEGER, p_seq BIGINT,
  p_fix_age INTEGER DEFAULT 1000,
  p_path JSONB DEFAULT '[{"lat": -33.87, "lng": 151.2}]',
  p_rv INTEGER DEFAULT 1,
  p_sent TIMESTAMPTZ DEFAULT now()
) RETURNS TEXT LANGUAGE sql AS $$
  SELECT public.publish_live_location(
    pg_temp.id(p_walk), p_gen, p_seq, -33.87, 151.20, 5, p_fix_age, 500, p_sent, p_rv, p_path) ->> 'status'
$$;

INSERT INTO auth.users (id, email)
SELECT v, k || '@pgtap.test' FROM t WHERE k IN ('host', 'friend', 'viewer', 'decliner', 'other', 'stranger');

INSERT INTO community_packs (id, name, owner_id)
VALUES (pg_temp.id('pack'), 'Sunday Pack', pg_temp.id('host'));

INSERT INTO community_pack_members (pack_id, user_id, role, archive_from) VALUES
  (pg_temp.id('pack'), pg_temp.id('host'),     'owner',  '-infinity'),
  (pg_temp.id('pack'), pg_temp.id('friend'),   'member', now()),
  (pg_temp.id('pack'), pg_temp.id('viewer'),   'member', now()),
  (pg_temp.id('pack'), pg_temp.id('decliner'), 'member', now()),
  (pg_temp.id('pack'), pg_temp.id('other'),    'member', now());

INSERT INTO community_walks (id, pack_id, organizer_id, title, meeting_label, state, started_at) VALUES
  (pg_temp.id('w1'), pg_temp.id('pack'), pg_temp.id('host'), 'Sunday morning', 'The usual corner', 'active', now()),
  (pg_temp.id('w2'), pg_temp.id('pack'), pg_temp.id('host'), 'Other side',     'The far gate',     'active', now());

INSERT INTO community_walk_attendance (walk_id, user_id, status, share_location, joined_at) VALUES
  (pg_temp.id('w1'), pg_temp.id('host'),     'walking',      true,  now()),
  (pg_temp.id('w1'), pg_temp.id('friend'),   'walking',      true,  now()),
  (pg_temp.id('w1'), pg_temp.id('viewer'),   'coming',       false, NULL),
  (pg_temp.id('w1'), pg_temp.id('decliner'), 'cant_make_it', false, NULL),
  (pg_temp.id('w2'), pg_temp.id('other'),    'walking',      true,  now());

-- ══ 1. The privacy bug stays fixed ═════════════════════════════════════════
SET LOCAL ROLE authenticated;

-- An older build still writes directly (allowed until Phase 0b), under the
-- corrected policy.
SELECT pg_temp.act_as('host');
SELECT lives_ok(
  format('INSERT INTO community_live_locations (walk_id, user_id, lat, lng) VALUES (%L, %L, -33.87, 151.2)',
         pg_temp.id('w1'), pg_temp.id('host')),
  'a walking, sharing attendee can still write directly (older builds, until 0b)'
);

SELECT pg_temp.act_as('viewer');
SELECT is((SELECT count(*)::INT FROM community_live_locations WHERE walk_id = pg_temp.id('w1')), 1,
  'an attendee who said "coming" sees the walking party');

SELECT pg_temp.act_as('other');
SELECT is((SELECT count(*)::INT FROM community_live_locations WHERE walk_id = pg_temp.id('w1')), 0,
  'walking in another walk of the same pack shows you nothing of this one');
SELECT throws_ok(
  format('INSERT INTO community_live_locations (walk_id, user_id, lat, lng) VALUES (%L, %L, 1, 1)',
         pg_temp.id('w1'), pg_temp.id('other')),
  '42501', NULL,
  'and lets you write nothing into it'
);

SELECT pg_temp.act_as('decliner');
SELECT is((SELECT count(*)::INT FROM community_live_locations WHERE walk_id = pg_temp.id('w1')), 0,
  'someone who said they cannot make it sees nothing');

SELECT pg_temp.act_as('stranger');
SELECT is((SELECT count(*)::INT FROM community_live_locations WHERE walk_id = pg_temp.id('w1')), 0,
  'a non-member sees nothing');

SELECT pg_temp.act_as('friend');
SELECT throws_ok(
  format('INSERT INTO community_live_locations (walk_id, user_id, lat, lng) VALUES (%L, %L, 1, 1)',
         pg_temp.id('w1'), pg_temp.id('host')),
  '42501', NULL,
  'nobody writes a position for someone else'
);

-- ══ 2. One issuer of generations ═══════════════════════════════════════════
SELECT pg_temp.act_as('host');
SELECT is(pg_temp.begin('w1', 'tokA') ->> 'status', 'ok', 'a first session starts');
SELECT is((pg_temp.begin('w1', 'tokA') ->> 'gen')::INT, 1, 'and is generation 1');
SELECT is(pg_temp.begin('w1', 'tokA') ->> 'status', 'ok', 'a retry of the same start is the same session');
SELECT is((pg_temp.begin('w1', 'tokA') ->> 'gen')::INT, 1, 'with the same generation');
SELECT ok(pg_temp.begin('w1', 'tokA') ? 'server_now', 'every answer carries the server''s clock');
SELECT is((pg_temp.begin('w1', 'tokB') ->> 'gen')::INT, 2, 'a relaunch (new token) is generation 2');
SELECT is(pg_temp.begin('w1', 'tokA') ->> 'status', 'superseded', 'retrying the older start now says superseded');
SELECT is((pg_temp.begin('w1', 'tokA') ->> 'gen')::INT, 2, 'and reports the current generation');
SELECT is((pg_temp.begin('w1', 'tokB') ->> 'gen')::INT, 2, 'the older retry never advanced it');

SELECT pg_temp.act_as('viewer');
SELECT is(pg_temp.begin('w1', 'tokA') ->> 'status', 'not_sharing', 'someone not walking gets no session');
SELECT pg_temp.act_as('stranger');
SELECT is(pg_temp.begin('w1', 'tokA') ->> 'status', 'not_sharing', 'nor does a non-member, and they learn nothing else');

-- ══ 3. Ordered writes ═══════════════════════════════════════════════════════
SELECT pg_temp.act_as('host');
SELECT is(pg_temp.pub('w1', 1, 50), 'superseded', 'a write from the replaced session is refused');
SELECT is(pg_temp.pub('w1', 2, 1), 'ok', 'the current session takes over the direct-written row');
SELECT is((SELECT live_gen FROM community_live_locations WHERE walk_id = pg_temp.id('w1') AND user_id = pg_temp.id('host')), 2,
  'which now carries the generation');
SELECT is(pg_temp.pub('w1', 2, 1), 'stale', 'the same write again is stale');
SELECT is(pg_temp.pub('w1', 2, 3), 'ok', 'a newer one lands');
SELECT is(pg_temp.pub('w1', 2, 2), 'stale', 'a late, older one does not');
SELECT is((SELECT seq FROM community_live_locations WHERE walk_id = pg_temp.id('w1') AND user_id = pg_temp.id('host')), 3::BIGINT,
  'and the stored write is still the newest');
SELECT is(pg_temp.pub('w1', 3, 99), 'superseded', 'a generation nobody issued is refused');

SELECT pg_temp.act_as('friend');
SELECT is(pg_temp.pub('w1', 1, 1), 'superseded', 'publishing before any session is refused');

-- ══ 4. No sender clock is trusted ══════════════════════════════════════════
SELECT pg_temp.act_as('host');
SELECT is(pg_temp.pub('w1', 2, 4, 2000, '[{"lat": -33.87, "lng": 151.2}]', 1, now() + interval '5 minutes'), 'ok',
  'a phone whose clock is 5 minutes fast is accepted');
SELECT is((SELECT fix_at FROM community_live_locations WHERE walk_id = pg_temp.id('w1') AND user_id = pg_temp.id('host')),
  now() - interval '2 seconds',
  'its fix time comes from the server''s clock minus the age it reported');
SELECT is((SELECT sent_at FROM community_live_locations WHERE walk_id = pg_temp.id('w1') AND user_id = pg_temp.id('host')),
  now() + interval '5 minutes',
  'its own clock is kept, for diagnosis only');
SELECT is(pg_temp.pub('w1', 2, 5, 3000, '[{"lat": -33.87, "lng": 151.2}]', 1, now() - interval '5 minutes'), 'ok',
  'so is one 5 minutes slow');

-- ══ 5. Validation ═══════════════════════════════════════════════════════════
SELECT throws_ok(
  format('SELECT publish_live_location(%L, 2, 10, 91, 0, 5, 0, NULL, now(), 1, %L)', pg_temp.id('w1'), '[]'),
  '22023', 'invalid_input', 'a latitude beyond 90 is refused');
SELECT throws_ok(
  format('SELECT publish_live_location(%L, 2, 0, 1, 1, 5, 0, NULL, now(), 1, %L)', pg_temp.id('w1'), '[]'),
  '22023', 'invalid_input', 'sequence numbers start at 1');
SELECT throws_ok(
  format('SELECT publish_live_location(%L, 2, 10, 1, 1, 5, -1, NULL, now(), 1, %L)', pg_temp.id('w1'), '[]'),
  '22023', 'invalid_input', 'a negative age is refused');
SELECT throws_ok(
  format('SELECT publish_live_location(%L, 2, 10, 1, 1, 5, 21600001, NULL, now(), 1, %L)', pg_temp.id('w1'), '[]'),
  '22023', 'invalid_input', 'an age over 6 hours is refused');
SELECT throws_ok(
  format('SELECT publish_live_location(%L, 2, 10, 1, 1, 5, 0, NULL, now(), 100001, %L)', pg_temp.id('w1'), '[]'),
  '22023', 'invalid_input', 'a route version beyond the bound is refused');
SELECT throws_ok(
  format('SELECT publish_live_location(%L, NULL, 10, 1, 1, 5, 0, NULL, now(), 1, %L)', pg_temp.id('w1'), '[]'),
  '22023', 'invalid_input', 'a missing generation is refused');
SELECT throws_ok(
  format('SELECT publish_live_location(%L, 2, 10, 1, 1, 5, 0, NULL, now(), 1, %L)', pg_temp.id('w1'), '{"lat": 1}'),
  '22023', 'invalid_input', 'a route that is not a list is refused');
SELECT throws_ok(
  format('SELECT publish_live_location(%L, 2, 10, 1, 1, 5, 0, NULL, now(), 1, %L)', pg_temp.id('w1'),
         (SELECT jsonb_agg(jsonb_build_object('lat', 1, 'lng', 1)) FROM generate_series(1, 201))),
  '22023', 'invalid_input', 'a route over 200 points is refused');
SELECT throws_ok(
  format('SELECT publish_live_location(%L, 2, 10, 1, 1, 5, 0, NULL, now(), 1, %L)', pg_temp.id('w1'), '[{"lat": "1", "lng": 1}]'),
  '22023', 'invalid_input', 'a route point that is not a number pair is refused');
SELECT throws_ok(
  format('SELECT publish_live_location(%L, 2, 10, 1, 1, 5, 0, NULL, now(), 1, %L)', pg_temp.id('w1'), '[{"lat": 1, "lng": 181}]'),
  '22023', 'invalid_input', 'a route point out of range is refused');

SELECT is(pg_temp.pub('w1', 2, 6, 0, '[{"lat": 1, "lng": 2, "note": "x"}]'), 'ok', 'a route point with extra keys is accepted');
SELECT is((SELECT path FROM community_live_locations WHERE walk_id = pg_temp.id('w1') AND user_id = pg_temp.id('host')),
  '[{"lat": 1, "lng": 2}]'::JSONB, 'but stored as the bare pair');

-- ══ 6. Reading, and no position outliving its permission ═══════════════════
SELECT pg_temp.act_as('friend');
SELECT is((pg_temp.begin('w1', 'tokF') ->> 'gen')::INT, 1, 'the friend starts a session of their own');
SELECT is(pg_temp.pub('w1', 1, 1), 'ok', 'and publishes');

SELECT pg_temp.act_as('viewer');
SELECT is(jsonb_array_length(live_walk_positions(pg_temp.id('w1')) -> 'rows'), 2, 'the viewer reads both walkers');
SELECT is(
  (SELECT (w ->> 'gen')::INT FROM jsonb_array_elements(live_walk_positions(pg_temp.id('w1')) -> 'watermarks') w
    WHERE (w ->> 'user_id')::UUID = pg_temp.id('host')),
  2, 'with each walker''s current generation');
SELECT pg_temp.act_as('other');
SELECT is(live_walk_positions(pg_temp.id('w1')) ->> 'status', 'not_visible',
  'the read is no way round the policy');

-- Sharing off removes the position; finishing does too.
RESET ROLE;
UPDATE community_walk_attendance SET share_location = false
 WHERE walk_id = pg_temp.id('w1') AND user_id = pg_temp.id('friend');
SELECT is((SELECT count(*)::INT FROM community_live_locations WHERE walk_id = pg_temp.id('w1') AND user_id = pg_temp.id('friend')), 0,
  'turning sharing off removes the position');

UPDATE community_walk_attendance SET share_location = true
 WHERE walk_id = pg_temp.id('w1') AND user_id = pg_temp.id('friend');
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('friend');
SELECT is((pg_temp.begin('w1', 'tokF2') ->> 'gen')::INT, 2, 'sharing again is a new session');
SELECT is(pg_temp.pub('w1', 2, 1), 'ok', 'which may publish again');

RESET ROLE;
UPDATE community_walk_attendance SET status = 'finished', finished_at = now()
 WHERE walk_id = pg_temp.id('w1') AND user_id = pg_temp.id('friend');
SELECT is((SELECT count(*)::INT FROM community_live_locations WHERE walk_id = pg_temp.id('w1') AND user_id = pg_temp.id('friend')), 0,
  'finishing removes the position');
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('friend');
SELECT is(pg_temp.pub('w1', 2, 2), 'not_sharing', 'and stops any further write');

-- w2 has a walker of its own, to show closing w1 leaves it alone.
SELECT pg_temp.act_as('other');
SELECT is(pg_temp.pub('w2', (pg_temp.begin('w2', 'tokO') ->> 'gen')::INT, 1), 'ok', 'a walker on the other walk publishes');

RESET ROLE;
UPDATE community_walks SET state = 'completed', ended_at = now() WHERE id = pg_temp.id('w1');
SELECT is((SELECT count(*)::INT FROM community_live_locations WHERE walk_id = pg_temp.id('w1')), 0,
  'closing the walk removes every position on it');
SELECT is((SELECT count(*)::INT FROM community_live_locations WHERE walk_id = pg_temp.id('w2')), 1,
  'and none on any other walk');

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('host');
SELECT is(pg_temp.pub('w1', 2, 99), 'walk_closed', 'a write after the close is told the walk is over');

-- ══ 7. Grants ═══════════════════════════════════════════════════════════════
SELECT throws_ok('SELECT count(*) FROM private.live_sessions', '42501', NULL,
  'a signed-in user cannot read the session table');
SELECT throws_ok(format('SELECT private.live_refusal(%L)', pg_temp.id('w1')), '42501', NULL,
  'or call the refusal helper');

SET LOCAL ROLE anon;
SELECT throws_ok(format('SELECT begin_live_session(%L, %L)', pg_temp.id('w1'), pg_temp.id('tokA')), '42501', NULL,
  'anon cannot start a session');
SELECT throws_ok(format('SELECT live_walk_positions(%L)', pg_temp.id('w1')), '42501', NULL,
  'anon cannot read positions');

SELECT * FROM finish();
ROLLBACK;
