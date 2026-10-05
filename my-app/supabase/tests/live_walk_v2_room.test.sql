-- pgTAP suite for Live Walk v2, Phase 1 (20261004010000_live_walk_room_and_transport).
-- Needs Phase 0a (20261004000000) applied first. Branch database only; rolls back.
--
-- What it pins down:
--   1. TOPICS. Only `walk:<lowercase uuid>` names a walk, and no topic, however
--      malformed, makes the policy raise.
--   2. THE ROOM. Exactly two policies on realtime.messages. Broadcast and
--      Presence only, for members attending that active walk; nobody else.
--   3. THE SERVER PICKS THE TRANSPORT. `broadcast` only with the kill switch
--      on, the host asking, and a new enough build. The kill switch blocks new
--      broadcast walks at once; the emergency switch flips running ones.
--   4. THE BUILD GATE. v1 (builds 98/99) and old protocols are refused on a
--      broadcast walk and work as before everywhere else.
--   5. NO SIDE DOOR. A host cannot set the transport by updating the row.

BEGIN;
SELECT plan(36);

CREATE TEMP TABLE t (k TEXT PRIMARY KEY, v UUID);
GRANT SELECT ON t TO authenticated, anon;

INSERT INTO t VALUES
  ('host', gen_random_uuid()), ('friend', gen_random_uuid()), ('viewer', gen_random_uuid()),
  ('other', gen_random_uuid()), ('stranger', gen_random_uuid()),
  ('hostdog', gen_random_uuid()), ('frienddog', gen_random_uuid()),
  ('pack', gen_random_uuid()),
  ('w1', gen_random_uuid()), ('w2', gen_random_uuid()),
  ('p1', gen_random_uuid()), ('p2', gen_random_uuid()), ('p3', gen_random_uuid()),
  ('p4', gen_random_uuid()), ('p5', gen_random_uuid());

CREATE FUNCTION pg_temp.id(p_key TEXT) RETURNS UUID
  LANGUAGE sql STABLE AS $$ SELECT v FROM t WHERE k = p_key $$;
CREATE FUNCTION pg_temp.act_as(p_key TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.id(p_key), 'role', 'authenticated')::TEXT, TRUE);
END;
$$;
CREATE FUNCTION pg_temp.room(p_walk TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('realtime.topic', 'walk:' || pg_temp.id(p_walk)::TEXT, TRUE);
END;
$$;
CREATE FUNCTION pg_temp.start(p_walk TEXT, p_protocol INTEGER, p_request BOOLEAN) RETURNS TEXT
  LANGUAGE sql AS $$
  SELECT public.join_community_walk_v2(pg_temp.id(p_walk), ARRAY[pg_temp.id('hostdog')], true, true, p_protocol, p_request)
         ->> 'live_transport'
$$;

INSERT INTO auth.users (id, email)
SELECT v, k || '@pgtap.test' FROM t WHERE k IN ('host', 'friend', 'viewer', 'other', 'stranger');

INSERT INTO pets (id, owner_id, name, species, current_weight_kg, target_daily_calories, bowl_size) VALUES
  (pg_temp.id('hostdog'),   pg_temp.id('host'),   'Sam',   'dog', 18.0, 1200, 'medium'),
  (pg_temp.id('frienddog'), pg_temp.id('friend'), 'Bella', 'dog', 12.4, 900,  'medium');

INSERT INTO community_packs (id, name, owner_id)
VALUES (pg_temp.id('pack'), 'Sunday Pack', pg_temp.id('host'));

INSERT INTO community_pack_members (pack_id, user_id, role, archive_from) VALUES
  (pg_temp.id('pack'), pg_temp.id('host'),   'owner',  '-infinity'),
  (pg_temp.id('pack'), pg_temp.id('friend'), 'member', now()),
  (pg_temp.id('pack'), pg_temp.id('viewer'), 'member', now()),
  (pg_temp.id('pack'), pg_temp.id('other'),  'member', now());

INSERT INTO community_walks (id, pack_id, organizer_id, title, meeting_label, state, started_at)
SELECT pg_temp.id(k), pg_temp.id('pack'), pg_temp.id('host'), 'Walk ' || k, 'The usual corner',
       CASE WHEN k IN ('w1', 'w2') THEN 'active' ELSE 'planned' END,
       CASE WHEN k IN ('w1', 'w2') THEN now() END
  FROM unnest(ARRAY['w1', 'w2', 'p1', 'p2', 'p3', 'p4', 'p5']) AS k;

INSERT INTO community_walk_attendance (walk_id, user_id, status, share_location, joined_at) VALUES
  (pg_temp.id('w1'), pg_temp.id('host'),   'walking', true,  now()),
  (pg_temp.id('w1'), pg_temp.id('viewer'), 'coming',  false, NULL),
  (pg_temp.id('w2'), pg_temp.id('other'),  'walking', true,  now());

-- ══ 1. Topics ═══════════════════════════════════════════════════════════════
SELECT is(private.walk_id_from_topic('walk:' || pg_temp.id('w1')), pg_temp.id('w1'), 'walk:<uuid> names the walk');
SELECT is(private.walk_id_from_topic(upper('walk:' || pg_temp.id('w1'))), NULL::UUID, 'upper case names nothing');
SELECT is(private.walk_id_from_topic('walk:' || pg_temp.id('w1') || 'x'), NULL::UUID, 'trailing characters name nothing');
SELECT is(private.walk_id_from_topic('walk:not-a-uuid'), NULL::UUID, 'a malformed id names nothing, without raising');
SELECT is(private.walk_id_from_topic('spike:a1'), NULL::UUID, 'another prefix names nothing');
SELECT is(private.walk_id_from_topic(NULL), NULL::UUID, 'no topic names nothing');

-- ══ 2. The room ═════════════════════════════════════════════════════════════
SELECT is(
  (SELECT array_agg(polname::TEXT ORDER BY polname) FROM pg_policy WHERE polrelid = 'realtime.messages'::regclass),
  ARRAY['live_walk_room_read', 'live_walk_room_write'],
  'realtime.messages has exactly the two room policies');

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('viewer');
SELECT pg_temp.room('w1');
SELECT lives_ok(
  format('INSERT INTO realtime.messages (topic, extension, event, payload) VALUES (%L, %L, %L, %L)',
         'walk:' || pg_temp.id('w1'), 'broadcast', 'req', '{}'),
  'an attendee may send in the walk''s room');
SELECT is((SELECT count(*)::INT FROM realtime.messages WHERE topic = 'walk:' || pg_temp.id('w1')), 1,
  'and receive in it');
SELECT lives_ok(
  format('INSERT INTO realtime.messages (topic, extension, event, payload) VALUES (%L, %L, %L, %L)',
         'walk:' || pg_temp.id('w1'), 'presence', 'track', '{}'),
  'and be present in it');
SELECT throws_ok(
  format('INSERT INTO realtime.messages (topic, extension, event, payload) VALUES (%L, %L, %L, %L)',
         'walk:' || pg_temp.id('w1'), 'postgres_changes', 'x', '{}'),
  '42501', NULL, 'but nothing beyond Broadcast and Presence');

SELECT pg_temp.room('w2');
SELECT is((SELECT count(*)::INT FROM realtime.messages), 0, 'the room of a walk you are not on shows nothing');

SELECT pg_temp.act_as('other');
SELECT pg_temp.room('w1');
SELECT throws_ok(
  format('INSERT INTO realtime.messages (topic, extension, event, payload) VALUES (%L, %L, %L, %L)',
         'walk:' || pg_temp.id('w1'), 'broadcast', 'pos', '{}'),
  '42501', NULL, 'walking another walk of the pack does not open this room');

SELECT pg_temp.act_as('stranger');
SELECT throws_ok(
  format('INSERT INTO realtime.messages (topic, extension, event, payload) VALUES (%L, %L, %L, %L)',
         'walk:' || pg_temp.id('w1'), 'broadcast', 'pos', '{}'),
  '42501', NULL, 'nor does knowing the walk id');

SELECT pg_temp.act_as('host');
SELECT set_config('realtime.topic', 'walk:XYZ', TRUE);
SELECT throws_ok(
  format('INSERT INTO realtime.messages (topic, extension, event, payload) VALUES (%L, %L, %L, %L)',
         'walk:XYZ', 'broadcast', 'pos', '{}'),
  '42501', NULL, 'a malformed topic is refused, not an error');

SET LOCAL ROLE anon;
SELECT pg_temp.room('w1');
SELECT throws_ok(
  format('INSERT INTO realtime.messages (topic, extension, event, payload) VALUES (%L, %L, %L, %L)',
         'walk:' || pg_temp.id('w1'), 'broadcast', 'pos', '{}'),
  '42501', NULL, 'anon has no room at all');

-- ══ 3. The server picks the transport ══════════════════════════════════════
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('host');
SELECT is(pg_temp.start('p1', 2, true), 'db', 'with Broadcast off, a new walk is db even when asked');

RESET ROLE;
UPDATE private.live_settings SET broadcast_enabled = true;
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('host');
SELECT is(pg_temp.start('p2', 2, true), 'broadcast', 'with it on, a supported host who asks gets broadcast');
SELECT is(pg_temp.start('p3', 1, true), 'db', 'an old protocol gets db');
SELECT is(pg_temp.start('p5', 2, false), 'db', 'a host who does not ask gets db');

-- ══ 4. The build gate ═══════════════════════════════════════════════════════
SELECT pg_temp.act_as('friend');
SELECT throws_ok(
  format('SELECT join_community_walk(%L, ARRAY[%L]::UUID[], true)', pg_temp.id('p2'), pg_temp.id('frienddog')),
  'P0001', 'update_required', 'builds 98/99 (v1) cannot join a broadcast walk');
SELECT throws_ok(
  format('SELECT join_community_walk_v2(%L, ARRAY[%L]::UUID[], true)', pg_temp.id('p2'), pg_temp.id('frienddog')),
  'P0001', 'update_required', 'nor can v2 when the protocol is left out');
SELECT is(
  join_community_walk_v2(pg_temp.id('p2'), ARRAY[pg_temp.id('frienddog')], true, false, 2, false) ->> 'live_transport',
  'broadcast', 'a supported build joins it, and is told the transport');
SELECT is(
  (SELECT status FROM community_walk_attendance WHERE walk_id = pg_temp.id('p2') AND user_id = pg_temp.id('friend')),
  'walking', 'as a walker');
SELECT lives_ok(
  format('SELECT join_community_walk(%L, ARRAY[%L]::UUID[], true)', pg_temp.id('w1'), pg_temp.id('frienddog')),
  'v1 still joins a db walk exactly as before');
SELECT is(
  join_community_walk_v2(pg_temp.id('w1'), ARRAY[pg_temp.id('frienddog')], true) ->> 'live_transport',
  'db', 'v2 with only v1''s arguments joins a db walk');
SELECT throws_ok(
  format('SELECT join_community_walk_v2(%L, ARRAY[%L]::UUID[], true)', pg_temp.id('w1'), pg_temp.id('hostdog')),
  'P0001', 'pet_not_yours', 'only your own dogs, as before');
SELECT throws_ok(
  format('SELECT join_community_walk_v2(%L, ARRAY[]::UUID[], true, true, 2, true)', pg_temp.id('p4')),
  'P0001', 'pack_host_required', 'only the host starts a walk, as before');

-- The kill switch: new walks fall back at once, running ones are left alone.
RESET ROLE;
UPDATE private.live_settings SET broadcast_enabled = false;
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('host');
SELECT is(pg_temp.start('p4', 2, true), 'db', 'the kill switch makes the next walk db immediately');
SELECT is((SELECT live_transport FROM community_walks WHERE id = pg_temp.id('p2')), 'broadcast',
  'without touching a walk already running');

-- The build gate can move.
RESET ROLE;
UPDATE private.live_settings SET min_protocol = 3;
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('friend');
SELECT throws_ok(
  format('SELECT join_community_walk_v2(%L, ARRAY[%L]::UUID[], true, false, 2, false)', pg_temp.id('p2'), pg_temp.id('frienddog')),
  'P0001', 'update_required', 'raising min_protocol turns away builds below it');

-- ══ 5. No side door ═════════════════════════════════════════════════════════
SELECT pg_temp.act_as('host');
SELECT throws_ok(
  format('UPDATE community_walks SET live_transport = %L WHERE id = %L', 'broadcast', pg_temp.id('w1')),
  '42501', 'live_transport_locked', 'the host cannot switch a walk to broadcast by updating it');
SELECT lives_ok(
  format('UPDATE community_walks SET state = %L, ended_at = now() WHERE id = %L', 'completed', pg_temp.id('w1')),
  'closing the walk directly still works');

RESET ROLE;
UPDATE community_walks SET live_transport = 'db' WHERE id = pg_temp.id('p2');
SELECT is((SELECT live_transport FROM community_walks WHERE id = pg_temp.id('p2')), 'db',
  'the emergency switch (as admin) flips a running walk to db');

SET LOCAL ROLE authenticated;
SELECT throws_ok('SELECT * FROM private.live_settings', '42501', NULL, 'signed-in users cannot read the settings');
SET LOCAL ROLE anon;
SELECT throws_ok(
  format('SELECT join_community_walk_v2(%L, ARRAY[]::UUID[], true)', pg_temp.id('w2')),
  '42501', NULL, 'anon cannot call the join');

SELECT * FROM finish();
ROLLBACK;
