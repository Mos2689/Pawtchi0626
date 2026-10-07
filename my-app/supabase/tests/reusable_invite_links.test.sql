-- pgTAP suite for 20261008000000_reusable_invite_links.
-- Branch database only; rolls back. Run invite_claims.test.sql alongside it:
-- ordinary one-person links must behave exactly as before.
--
-- What it pins down:
--   1. Only the admin (SQL editor) can make or end a community link.
--   2. Many people can ask through one link; each is a separate request the
--      host confirms or refuses, and the link itself is never spent.
--   3. Asking twice is one request and one push; a refusal stands.
--   4. The cap, the expiry and ending the link all refuse new people.

BEGIN;
SELECT plan(33);

CREATE TEMP TABLE t (k TEXT PRIMARY KEY, v UUID);
GRANT SELECT ON t TO authenticated, anon;
INSERT INTO t VALUES
  ('host', gen_random_uuid()), ('member', gen_random_uuid()),
  ('ana', gen_random_uuid()), ('ben', gen_random_uuid()), ('cat', gen_random_uuid()), ('dan', gen_random_uuid()),
  ('pack', gen_random_uuid()), ('link', gen_random_uuid()), ('capped', gen_random_uuid()),
  ('old', gen_random_uuid()), ('used', gen_random_uuid());

CREATE FUNCTION pg_temp.id(p_key TEXT) RETURNS UUID LANGUAGE sql STABLE AS $$ SELECT v FROM t WHERE k = p_key $$;
CREATE FUNCTION pg_temp.act_as(p_key TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.id(p_key), 'role', 'authenticated')::TEXT, TRUE);
END;
$$;
CREATE FUNCTION pg_temp.code(p_invite TEXT) RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT invite_code FROM public.community_pack_invitations WHERE id = pg_temp.id(p_invite) $$;
CREATE FUNCTION pg_temp.claim(p_invite TEXT) RETURNS TEXT LANGUAGE sql AS
  $$ SELECT public.claim_external_community_invite(pg_temp.code(p_invite)) $$;
CREATE FUNCTION pg_temp.requests(p_invite TEXT) RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT count(*)::INT FROM public.community_pack_invitations WHERE parent_invite_id = pg_temp.id(p_invite) $$;
CREATE FUNCTION pg_temp.request_of(p_invite TEXT, p_who TEXT) RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT id FROM public.community_pack_invitations
     WHERE parent_invite_id = pg_temp.id(p_invite) AND claimed_by = pg_temp.id(p_who) $$;
CREATE FUNCTION pg_temp.events(p_type TEXT) RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT count(*)::INT FROM public.community_notification_events WHERE event_type = p_type $$;

INSERT INTO auth.users (id, email)
SELECT v, k || '@pgtap.test' FROM t WHERE k IN ('host', 'member', 'ana', 'ben', 'cat', 'dan');
INSERT INTO profiles (id, full_name, username) VALUES
  (pg_temp.id('host'), 'Salty Dog Club', 'saltydogclub'),
  (pg_temp.id('member'), 'Member Owner', 'member_owner'),
  (pg_temp.id('ana'), 'Ana Lee', 'ana'),
  (pg_temp.id('ben'), 'Ben Ray', 'ben'),
  (pg_temp.id('cat'), 'Cat Moss', 'cat'),
  (pg_temp.id('dan'), 'Dan Fox', 'dan')
ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, username = EXCLUDED.username;

INSERT INTO community_packs (id, name, owner_id) VALUES (pg_temp.id('pack'), 'Salty Dog Social', pg_temp.id('host'));
INSERT INTO community_pack_members (pack_id, user_id, role, archive_from) VALUES
  (pg_temp.id('pack'), pg_temp.id('host'), 'owner', '-infinity'),
  (pg_temp.id('pack'), pg_temp.id('member'), 'member', now());

INSERT INTO community_pack_invitations (id, pack_id, inviter_id, invitee_id, claimed_by, state, expires_at) VALUES
  (pg_temp.id('link'),   pg_temp.id('pack'), pg_temp.id('host'), NULL, NULL, 'pending', now() + interval '14 days'),
  (pg_temp.id('capped'), pg_temp.id('pack'), pg_temp.id('host'), NULL, NULL, 'pending', now() + interval '14 days'),
  (pg_temp.id('old'),    pg_temp.id('pack'), pg_temp.id('host'), NULL, NULL, 'pending', now() + interval '14 days'),
  (pg_temp.id('used'),   pg_temp.id('pack'), pg_temp.id('host'), NULL, pg_temp.id('dan'), 'pending_host', now() + interval '14 days');

-- ══ 1. Only the admin makes a link ═══════════════════════════════════════════
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('host');
SELECT throws_ok(
  format('SELECT private.make_community_link(%L::uuid, now() + interval ''10 days'')', pg_temp.code('link')),
  '42501', NULL, 'a host cannot make a community link from the app');
RESET ROLE;

SELECT is(private.make_community_link(pg_temp.code('link'), now() + interval '10 days'),
  'https://pawtchi.com/app/community-invite?code=' || pg_temp.code('link')::TEXT,
  'the admin makes one and gets the link to share');
SELECT lives_ok(
  format('SELECT private.make_community_link(%L::uuid, now() + interval ''10 days'', 2)', pg_temp.code('capped')),
  'with an optional cap');
SELECT throws_ok(
  format('SELECT private.make_community_link(%L::uuid, now() + interval ''40 days'')', pg_temp.code('old')),
  'P0001', 'until_must_be_within_31_days', 'no further out than 31 days');
SELECT throws_ok(
  format('SELECT private.make_community_link(%L::uuid, now() + interval ''10 days'')', pg_temp.code('used')),
  'P0001', 'invite_already_used — share a fresh link from the meetup', 'a link someone already claimed cannot be reused');

-- ══ 2. Many people, one link, one request each ═══════════════════════════════
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('ana');
SELECT is(pg_temp.claim('link'), 'host_confirmation_required', 'Ana asks through the link');
SELECT pg_temp.act_as('ben');
SELECT is(pg_temp.claim('link'), 'host_confirmation_required', 'so does Ben');
SELECT pg_temp.act_as('cat');
SELECT is(pg_temp.claim('link'), 'host_confirmation_required', 'and Cat');
RESET ROLE;
SELECT is(pg_temp.requests('link'), 3, 'three separate requests');
SELECT is((SELECT state FROM community_pack_invitations WHERE id = pg_temp.id('link')), 'pending', 'the link itself is never spent');
SELECT is((SELECT claimed_by FROM community_pack_invitations WHERE id = pg_temp.id('link')), NULL::UUID, 'nor recorded against anyone');
SELECT is(pg_temp.events('community_join_request'), 3, 'the host is told about each');
SELECT is(
  (SELECT title || ' / ' || body FROM community_notification_events
    WHERE event_type = 'community_join_request' AND dedupe_key LIKE '%' || pg_temp.id('ana')::TEXT),
  'Ana Lee wants to join Salty Dog Social / They opened this meetup’s community link. Confirm them to let them in.',
  'by name, in community-link words');
SELECT is((SELECT count(*)::INT FROM community_pack_invitations
  WHERE parent_invite_id = pg_temp.id('link') AND inviter_id = pg_temp.id('host') AND pack_id = pg_temp.id('pack')
    AND state = 'pending_host'),
  3, 'each request is an ordinary pending claim on the same meetup');

-- ══ 3. Asking twice; the people a link should not move ══════════════════════
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('ana');
SELECT is(pg_temp.claim('link'), 'host_confirmation_required', 'Ana asking again gets the same answer');
RESET ROLE;
SELECT is(pg_temp.requests('link'), 3, 'without a second request');
SELECT is(pg_temp.events('community_join_request'), 3, 'or a second push');
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('host');
SELECT is(pg_temp.claim('link'), 'own_invite', 'the host opening it is told it is theirs');
SELECT pg_temp.act_as('member');
SELECT is(pg_temp.claim('link'), 'already_member', 'a member opening it is told they are in');

-- ══ 4. The host still decides ════════════════════════════════════════════════
SELECT pg_temp.act_as('member');
SELECT is(approve_external_community_invite(pg_temp.request_of('link', 'ana'), true), 'not_available',
  'only the host confirms');
SELECT pg_temp.act_as('host');
SELECT is(approve_external_community_invite(pg_temp.request_of('link', 'ana'), true), 'accepted', 'the host confirms Ana');
SELECT is(approve_external_community_invite(pg_temp.request_of('link', 'ben'), false), 'revoked', 'and refuses Ben');
RESET ROLE;
SELECT ok(public.is_community_pack_member(pg_temp.id('pack'), pg_temp.id('ana')), 'Ana is in');
SELECT ok(NOT public.is_community_pack_member(pg_temp.id('pack'), pg_temp.id('ben')), 'Ben is not');
SELECT is(pg_temp.events('community_join_approved'), 1, 'only Ana is told');
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('ben');
SELECT is(pg_temp.claim('link'), 'invalid_or_expired', 'a refusal stands when Ben opens the link again');
SELECT pg_temp.act_as('ana');
SELECT is(pg_temp.claim('link'), 'already_member', 'and Ana, now in, is told so');

-- ══ 5. Cap, expiry, ending the link ══════════════════════════════════════════
SELECT pg_temp.act_as('ana');
SELECT is(pg_temp.claim('capped'), 'already_member', 'members do not use up a capped link');
SELECT pg_temp.act_as('cat');
SELECT is(pg_temp.claim('capped'), 'host_confirmation_required', 'Cat takes one of two places');
SELECT pg_temp.act_as('dan');
SELECT is(pg_temp.claim('capped'), 'host_confirmation_required', 'Dan the second');
RESET ROLE;
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-4000-8000-0000000000e1', 'eve@pgtap.test');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e1","role":"authenticated"}', TRUE);
SELECT is(pg_temp.claim('capped'), 'invalid_or_expired', 'a third person finds it full');
RESET ROLE;

SELECT is(private.end_community_link(pg_temp.code('link')), 1, 'ending the link reports Cat still waiting');
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('dan');
SELECT is(pg_temp.claim('link'), 'invalid_or_expired', 'and refuses anyone new');

SELECT * FROM finish();
ROLLBACK;
