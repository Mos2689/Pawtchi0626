-- pgTAP suite for 20261005000000_invite_claim_notifications.
-- Branch database only; rolls back.
--
-- What it pins down:
--   1. Opening your own invite link, or a link to a meetup you are already in,
--      changes nothing — the link still works for the person it was meant for.
--   2. A claim tells the host, once, however often it is retried.
--   3. Approving tells the person, once; "not them" tells nobody.
--   4. Everything else that should be refused still is.

BEGIN;
SELECT plan(24);

CREATE TEMP TABLE t (k TEXT PRIMARY KEY, v UUID);
GRANT SELECT ON t TO authenticated, anon;
INSERT INTO t VALUES
  ('host', gen_random_uuid()), ('member', gen_random_uuid()), ('friend', gen_random_uuid()),
  ('stranger', gen_random_uuid()), ('pack', gen_random_uuid()),
  ('inv_host', gen_random_uuid()), ('inv_member', gen_random_uuid()), ('inv_expired', gen_random_uuid()),
  ('inv_named', gen_random_uuid()), ('inv_refused', gen_random_uuid());

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
CREATE FUNCTION pg_temp.events(p_type TEXT) RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT count(*)::INT FROM public.community_notification_events WHERE event_type = p_type $$;

INSERT INTO auth.users (id, email)
SELECT v, k || '@pgtap.test' FROM t WHERE k IN ('host', 'member', 'friend', 'stranger');
-- Production creates profiles with a trigger on auth.users; written here so
-- the test does not depend on it.
INSERT INTO profiles (id, full_name, username) VALUES
  (pg_temp.id('host'), 'Host Owner', 'host_owner'),
  (pg_temp.id('member'), 'Member Owner', 'member_owner'),
  (pg_temp.id('friend'), 'Friend Owner', 'bella_walks'),
  (pg_temp.id('stranger'), '', 'stranger_one')
ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, username = EXCLUDED.username;

INSERT INTO community_packs (id, name, owner_id) VALUES (pg_temp.id('pack'), 'Sunday Pack', pg_temp.id('host'));
INSERT INTO community_pack_members (pack_id, user_id, role, archive_from) VALUES
  (pg_temp.id('pack'), pg_temp.id('host'), 'owner', '-infinity'),
  (pg_temp.id('pack'), pg_temp.id('member'), 'member', now());

INSERT INTO community_pack_invitations (id, pack_id, inviter_id, invitee_id, state, expires_at) VALUES
  (pg_temp.id('inv_host'),    pg_temp.id('pack'), pg_temp.id('host'),   NULL, 'pending', now() + interval '14 days'),
  (pg_temp.id('inv_member'),  pg_temp.id('pack'), pg_temp.id('member'), NULL, 'pending', now() + interval '14 days'),
  (pg_temp.id('inv_expired'), pg_temp.id('pack'), pg_temp.id('host'),   NULL, 'pending', now() - interval '1 day'),
  (pg_temp.id('inv_named'),   pg_temp.id('pack'), pg_temp.id('host'),   pg_temp.id('stranger'), 'pending', now() + interval '14 days'),
  (pg_temp.id('inv_refused'), pg_temp.id('pack'), pg_temp.id('host'),   NULL, 'pending', now() + interval '14 days');

SET LOCAL ROLE authenticated;

-- ══ 1. Your own link, or a meetup you are already in ═══════════════════════
SELECT pg_temp.act_as('host');
SELECT is(pg_temp.claim('inv_host'), 'own_invite', 'the host opening their own link is told it is theirs');
SELECT is(pg_temp.claim('inv_member'), 'already_member', 'the host opening a member''s link is told they are in');
SELECT pg_temp.act_as('member');
SELECT is(pg_temp.claim('inv_host'), 'already_member', 'a member opening the host''s link is told they are in');
RESET ROLE;
SELECT is((SELECT state FROM community_pack_invitations WHERE id = pg_temp.id('inv_host')), 'pending',
  'and the link is still unused');
SELECT is((SELECT claimed_by FROM community_pack_invitations WHERE id = pg_temp.id('inv_host')), NULL::UUID,
  'with nobody recorded against it');
SET LOCAL ROLE authenticated;

-- ══ 2. A claim tells the host, once ═════════════════════════════════════════
SELECT pg_temp.act_as('friend');
SELECT is(pg_temp.claim('inv_host'), 'host_confirmation_required', 'the friend it was meant for can still use it');
SELECT is(pg_temp.events('community_join_request'), 1, 'and the host is told');
SELECT is(pg_temp.claim('inv_host'), 'host_confirmation_required', 'opening it again gives the same answer');
SELECT is(pg_temp.events('community_join_request'), 1, 'without telling the host twice');

RESET ROLE;
SELECT is(
  (SELECT user_id FROM community_notification_events WHERE event_type = 'community_join_request'),
  pg_temp.id('host'), 'the request goes to the host');
SELECT is(
  (SELECT title FROM community_notification_events WHERE event_type = 'community_join_request'),
  'Friend Owner wants to join Sunday Pack', 'naming who asked and which meetup');
SELECT is(
  (SELECT route FROM community_notification_events WHERE event_type = 'community_join_request'),
  '/community/' || pg_temp.id('pack')::TEXT, 'and opening the meetup, where the request is answered');
SET LOCAL ROLE authenticated;

-- ══ 3. Refusals that must hold ══════════════════════════════════════════════
SELECT pg_temp.act_as('stranger');
SELECT is(pg_temp.claim('inv_host'), 'invalid_or_expired', 'a link someone else has claimed is spent');
SELECT is(pg_temp.claim('inv_expired'), 'invalid_or_expired', 'an expired link is refused');
SELECT is(pg_temp.claim('inv_named'), 'invalid_or_expired', 'a code from a username invitation is not a link');
SELECT is(claim_external_community_invite(gen_random_uuid()), 'invalid_or_expired', 'an unknown code is refused');

-- ══ 4. Approving tells the person, once; "not them" tells nobody ════════════
SELECT pg_temp.act_as('member');
SELECT is(approve_external_community_invite(pg_temp.id('inv_host'), true), 'not_available',
  'only the host can confirm');
SELECT pg_temp.act_as('host');
SELECT is(approve_external_community_invite(pg_temp.id('inv_host'), true), 'accepted', 'the host confirms');
SELECT is(approve_external_community_invite(pg_temp.id('inv_host'), true), 'not_available', 'once');

RESET ROLE;
SELECT ok(public.is_community_pack_member(pg_temp.id('pack'), pg_temp.id('friend')), 'the friend is now a member');
SELECT is(
  (SELECT title || ' / ' || body FROM community_notification_events WHERE event_type = 'community_join_approved'),
  'You’re in Sunday Pack / Host Owner confirmed you. Open the meetup to see the next walk.',
  'and is told, by the host''s name');
SET LOCAL ROLE authenticated;

SELECT pg_temp.act_as('stranger');
SELECT is(pg_temp.claim('inv_refused'), 'host_confirmation_required', 'a stranger uses a forwarded link');
SELECT pg_temp.act_as('host');
SELECT is(approve_external_community_invite(pg_temp.id('inv_refused'), false), 'revoked', 'the host says not them');
SELECT is(pg_temp.events('community_join_approved'), 1, 'and the stranger is not notified');

SELECT * FROM finish();
ROLLBACK;
