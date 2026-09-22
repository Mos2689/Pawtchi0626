-- pgTAP suite for Community Walks: membership, invitation and live location.
--
-- Run against a BRANCH database, never production:
--   supabase db test --linked        (after `supabase branches create`)
-- or psql -f this file against a branch.
--
-- ── Why these tests and not others ─────────────────────────────────────────
--
-- Jest covers the pure parts of this feature (username format, route artwork,
-- which captures may be published). It cannot reach the part that actually
-- carries the privacy promises, because that part is RLS. Every assertion here
-- corresponds to a rule the product committed to in writing:
--
--   1. AN EXACT USERNAME IS NOT A DIRECTORY. Lookup returns the one person you
--      already know how to name, and nothing to browse.
--   2. A FORWARDED LINK IS NOT AN ADMISSION. Possession of an external invite
--      code gets a stranger as far as the host's confirmation and no further.
--   3. LIVE LOCATION IS THE NARROWEST PERMISSION IN THE FEATURE. Pack
--      membership does not grant it; attendance at an active outing does, and
--      losing membership takes it away in the same instant.
--
-- Rule 3 has a specific trap worth stating: attendance rows outlive the
-- membership that created them. Removing someone from a pack deletes their
-- member row and touches nothing else, so a policy that trusts attendance
-- alone keeps showing a removed member where everyone is walking.

BEGIN;
SELECT plan(18);

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Four owners, one pack, one active outing. Everything rolls back.
CREATE TEMP TABLE t (k TEXT PRIMARY KEY, v UUID);

INSERT INTO t VALUES
  ('host',      gen_random_uuid()),
  ('friend',    gen_random_uuid()),
  ('removed',   gen_random_uuid()),
  ('stranger',  gen_random_uuid()),
  ('refused',   gen_random_uuid()),
  ('hostdog',   gen_random_uuid()),
  ('frienddog', gen_random_uuid()),
  ('pack',      gen_random_uuid()),
  ('walk',      gen_random_uuid()),
  ('invite',    gen_random_uuid()),
  ('invite2',   gen_random_uuid());

INSERT INTO auth.users (id, email) VALUES
  ((SELECT v FROM t WHERE k='host'),     'host@pgtap.test'),
  ((SELECT v FROM t WHERE k='friend'),   'friend@pgtap.test'),
  ((SELECT v FROM t WHERE k='removed'),  'removed@pgtap.test'),
  ((SELECT v FROM t WHERE k='stranger'), 'stranger@pgtap.test'),
  ((SELECT v FROM t WHERE k='refused'),  'refused@pgtap.test');

UPDATE profiles SET username = 'host_owner', full_name = 'Host Owner'
  WHERE id = (SELECT v FROM t WHERE k='host');
UPDATE profiles SET username = 'bella_walks', full_name = 'Friend Owner'
  WHERE id = (SELECT v FROM t WHERE k='friend');
UPDATE profiles SET username = 'stranger_one', full_name = 'A Stranger'
  WHERE id = (SELECT v FROM t WHERE k='stranger');

INSERT INTO pets (id, owner_id, name, species, current_weight_kg, target_daily_calories, bowl_size)
VALUES
  ((SELECT v FROM t WHERE k='hostdog'),   (SELECT v FROM t WHERE k='host'),   'Sam',   'dog', 18.0, 1200, 'medium'),
  ((SELECT v FROM t WHERE k='frienddog'), (SELECT v FROM t WHERE k='friend'), 'Bella', 'dog', 12.4, 900,  'medium');

INSERT INTO community_packs (id, name, owner_id)
VALUES ((SELECT v FROM t WHERE k='pack'), 'Sunday Pack', (SELECT v FROM t WHERE k='host'));

INSERT INTO community_pack_members (pack_id, user_id, role, archive_from) VALUES
  ((SELECT v FROM t WHERE k='pack'), (SELECT v FROM t WHERE k='host'),    'owner',  '-infinity'),
  ((SELECT v FROM t WHERE k='pack'), (SELECT v FROM t WHERE k='friend'),  'member', now()),
  ((SELECT v FROM t WHERE k='pack'), (SELECT v FROM t WHERE k='removed'), 'member', now());

INSERT INTO community_walks (id, pack_id, organizer_id, title, meeting_label, state, started_at)
VALUES (
  (SELECT v FROM t WHERE k='walk'),
  (SELECT v FROM t WHERE k='pack'),
  (SELECT v FROM t WHERE k='host'),
  'Sunday morning',
  'The usual corner',
  'active',
  now()
);

-- The host is walking and sharing. The friend said "coming" and is on the way.
-- The removed owner also said "coming" — that row is deliberately left behind
-- when their membership goes, because that is what really happens.
INSERT INTO community_walk_attendance (walk_id, user_id, status, share_location, joined_at) VALUES
  ((SELECT v FROM t WHERE k='walk'), (SELECT v FROM t WHERE k='host'),    'walking', true,  now()),
  ((SELECT v FROM t WHERE k='walk'), (SELECT v FROM t WHERE k='friend'),  'coming',  false, NULL),
  ((SELECT v FROM t WHERE k='walk'), (SELECT v FROM t WHERE k='removed'), 'coming',  false, NULL);

INSERT INTO community_live_locations (walk_id, user_id, lat, lng, accuracy_m, recorded_at)
VALUES ((SELECT v FROM t WHERE k='walk'), (SELECT v FROM t WHERE k='host'), -33.87, 151.20, 8, now());

-- Two external invitations: one to approve, one to refuse.
INSERT INTO community_pack_invitations (id, pack_id, inviter_id) VALUES
  ((SELECT v FROM t WHERE k='invite'),  (SELECT v FROM t WHERE k='pack'), (SELECT v FROM t WHERE k='host')),
  ((SELECT v FROM t WHERE k='invite2'), (SELECT v FROM t WHERE k='pack'), (SELECT v FROM t WHERE k='host'));

-- ══ 1. An exact username, not a directory ══════════════════════════════════
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT v FROM t WHERE k='host'))::text, TRUE);

SELECT is(
  (SELECT user_id FROM lookup_community_username('bella_walks')),
  (SELECT v FROM t WHERE k='friend'),
  'the exact username resolves to the person it names'
);

SELECT is(
  (SELECT count(*)::INT FROM lookup_community_username('bella')),
  0,
  'a prefix finds nobody — there is no browsable directory'
);

SELECT is(
  (SELECT count(*)::INT FROM lookup_community_username('@BELLA_WALKS')),
  1,
  'the @ and the casing are cosmetic, the match is still exact'
);

SELECT is(
  (SELECT count(*)::INT FROM lookup_community_username('host_owner')),
  0,
  'you cannot look yourself up'
);

RESET ROLE;
INSERT INTO community_user_blocks (blocker_id, blocked_id)
VALUES ((SELECT v FROM t WHERE k='stranger'), (SELECT v FROM t WHERE k='host'));

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT v FROM t WHERE k='host'))::text, TRUE);

SELECT is(
  (SELECT count(*)::INT FROM lookup_community_username('stranger_one')),
  0,
  'someone who blocked you cannot be found by you either'
);

-- ══ 2. A forwarded link is not an admission ════════════════════════════════
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT v FROM t WHERE k='stranger'))::text, TRUE);

SELECT is(
  claim_external_community_invite(
    (SELECT invite_code FROM community_pack_invitations WHERE id = (SELECT v FROM t WHERE k='invite'))),
  'host_confirmation_required',
  'claiming a forwarded code asks the host, it does not let you in'
);

-- Asserted as the owner of the table rather than through the claimant's own
-- view: RLS would hide a membership row from a stranger whether or not it was
-- created, which is exactly the kind of test that passes for the wrong reason.
RESET ROLE;

SELECT is(
  (SELECT count(*)::INT FROM community_pack_members
    WHERE pack_id = (SELECT v FROM t WHERE k='pack')
      AND user_id = (SELECT v FROM t WHERE k='stranger')),
  0,
  'the claim created no membership on its own'
);

SELECT is(
  (SELECT state FROM community_pack_invitations WHERE id = (SELECT v FROM t WHERE k='invite')),
  'pending_host',
  'the invitation waits on the host rather than resolving itself'
);

-- A second claimant on the invitation the host will refuse.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT v FROM t WHERE k='refused'))::text, TRUE);
SELECT is(
  claim_external_community_invite(
    (SELECT invite_code FROM community_pack_invitations WHERE id = (SELECT v FROM t WHERE k='invite2'))),
  'host_confirmation_required',
  'a second forwarded code behaves the same way'
);

-- Only the host can settle either of them.
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT v FROM t WHERE k='friend'))::text, TRUE);
SELECT is(
  approve_external_community_invite((SELECT v FROM t WHERE k='invite'), TRUE),
  'not_available',
  'an ordinary member cannot admit a stranger to the pack'
);

SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT v FROM t WHERE k='host'))::text, TRUE);

SELECT is(
  approve_external_community_invite((SELECT v FROM t WHERE k='invite'), TRUE),
  'accepted',
  'the host confirming the person is what creates membership'
);

SELECT is(
  approve_external_community_invite((SELECT v FROM t WHERE k='invite2'), FALSE),
  'revoked',
  'the host refusing closes the invitation instead'
);

RESET ROLE;
SELECT is(
  (SELECT count(*)::INT FROM community_pack_members
    WHERE pack_id = (SELECT v FROM t WHERE k='pack')
      AND user_id = (SELECT v FROM t WHERE k='refused')),
  0,
  'a refused claimant never became a member'
);
SET LOCAL ROLE authenticated;

-- ══ 3. Live location is the narrowest permission ═══════════════════════════
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT v FROM t WHERE k='friend'))::text, TRUE);

SELECT is(
  (SELECT count(*)::INT FROM community_live_locations
    WHERE walk_id = (SELECT v FROM t WHERE k='walk')),
  1,
  'an attending member sees the walking party'
);

-- The stranger the host just admitted is a member of the pack and nothing more:
-- they never answered this outing, so there is nothing live for them to see.
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT v FROM t WHERE k='stranger'))::text, TRUE);

SELECT is(
  (SELECT count(*)::INT FROM community_live_locations
    WHERE walk_id = (SELECT v FROM t WHERE k='walk')),
  0,
  'joining a pack does not subscribe you to its live positions'
);

-- Now remove the third owner from the pack, leaving their attendance behind.
RESET ROLE;
DELETE FROM community_pack_members
  WHERE pack_id = (SELECT v FROM t WHERE k='pack')
    AND user_id = (SELECT v FROM t WHERE k='removed');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT v FROM t WHERE k='removed'))::text, TRUE);

SELECT is(
  (SELECT count(*)::INT FROM community_walk_attendance
    WHERE walk_id = (SELECT v FROM t WHERE k='walk')
      AND user_id = (SELECT v FROM t WHERE k='removed')),
  0,
  'a removed member loses the outing itself'
);

SELECT is(
  (SELECT count(*)::INT FROM community_live_locations
    WHERE walk_id = (SELECT v FROM t WHERE k='walk')),
  0,
  'and stops seeing where the pack is, in the same instant'
);

-- A member who is not walking cannot publish a position at all, for anyone.
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT v FROM t WHERE k='friend'))::text, TRUE);

SELECT throws_ok(
  format(
    'INSERT INTO community_live_locations (walk_id, user_id, lat, lng) VALUES (%L, %L, -33.88, 151.21)',
    (SELECT v FROM t WHERE k='walk'), (SELECT v FROM t WHERE k='friend')),
  '42501',
  NULL,
  'saying "coming" is not consent to be tracked'
);

SELECT * FROM finish();
ROLLBACK;
