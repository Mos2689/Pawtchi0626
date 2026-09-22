-- Community Walks
--
-- A pack is a private, persistent group. An outing is one plan made by that
-- pack. Every attendee still records an ordinary Pawtchi walk on their own
-- device; community_walk_sessions links those independent records together.
-- Membership, attendance, live location, and media publication remain four
-- separate decisions throughout this schema.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_key
  ON public.profiles (lower(username))
  WHERE username IS NOT NULL;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_username_format;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_username_format
  CHECK (username IS NULL OR username ~ '^[a-z0-9_]{3,24}$');

CREATE TABLE IF NOT EXISTS public.community_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 2 AND 48),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.community_pack_members (
  pack_id UUID NOT NULL REFERENCES public.community_packs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  archive_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  notifications_muted BOOLEAN NOT NULL DEFAULT false,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (pack_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.community_pack_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id UUID NOT NULL REFERENCES public.community_packs(id) ON DELETE CASCADE,
  inviter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invitee_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  invite_code UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  claimed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'pending_host', 'accepted', 'declined', 'revoked', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '14 days'),
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (invitee_id IS NOT NULL OR state IN ('pending', 'pending_host', 'revoked', 'expired'))
);

CREATE TABLE IF NOT EXISTS public.community_walks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id UUID NOT NULL REFERENCES public.community_packs(id) ON DELETE CASCADE,
  organizer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  title TEXT NOT NULL DEFAULT 'Pack walk' CHECK (char_length(trim(title)) BETWEEN 2 AND 72),
  scheduled_for TIMESTAMPTZ,
  meeting_label TEXT NOT NULL CHECK (char_length(trim(meeting_label)) BETWEEN 2 AND 100),
  meeting_lat DOUBLE PRECISION CHECK (meeting_lat IS NULL OR meeting_lat BETWEEN -90 AND 90),
  meeting_lng DOUBLE PRECISION CHECK (meeting_lng IS NULL OR meeting_lng BETWEEN -180 AND 180),
  note TEXT CHECK (note IS NULL OR char_length(note) <= 280),
  state TEXT NOT NULL DEFAULT 'planned'
    CHECK (state IN ('planned', 'active', 'completed', 'cancelled')),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.community_walk_attendance (
  walk_id UUID NOT NULL REFERENCES public.community_walks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'invited'
    CHECK (status IN ('invited', 'coming', 'cant_make_it', 'checked_in', 'walking', 'finished')),
  share_location BOOLEAN NOT NULL DEFAULT false,
  checked_in_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (walk_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.community_walk_participant_pets (
  walk_id UUID NOT NULL REFERENCES public.community_walks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pet_id UUID NOT NULL REFERENCES public.pets(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (walk_id, user_id, pet_id)
);

CREATE TABLE IF NOT EXISTS public.community_walk_sessions (
  walk_id UUID NOT NULL REFERENCES public.community_walks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pet_id UUID NOT NULL REFERENCES public.pets(id) ON DELETE CASCADE,
  -- No FK to walk_sessions on purpose. The recorder is offline-first and this
  -- link may arrive before its queued personal walk has synced.
  walk_session_id UUID NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (walk_id, user_id, walk_session_id)
);

CREATE TABLE IF NOT EXISTS public.community_live_locations (
  walk_id UUID NOT NULL REFERENCES public.community_walks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lat DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  accuracy_m DOUBLE PRECISION CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
  path JSONB NOT NULL DEFAULT '[]'::JSONB
    CHECK (jsonb_typeof(path) = 'array' AND jsonb_array_length(path) <= 200),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (walk_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.community_shared_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  walk_id UUID NOT NULL REFERENCES public.community_walks(id) ON DELETE CASCADE,
  contributor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Existing walk_media can sync after this publication decision, so this is
  -- kept as an id rather than a hard FK for the same offline reason as above.
  walk_media_id UUID NOT NULL UNIQUE,
  dog_ids UUID[] NOT NULL DEFAULT '{}',
  display_path TEXT,
  captured_at TIMESTAMPTZ NOT NULL,
  capture_lat DOUBLE PRECISION CHECK (capture_lat IS NULL OR capture_lat BETWEEN -90 AND 90),
  capture_lng DOUBLE PRECISION CHECK (capture_lng IS NULL OR capture_lng BETWEEN -180 AND 180),
  caption TEXT CHECK (caption IS NULL OR char_length(caption) <= 280),
  external_share_allowed BOOLEAN NOT NULL DEFAULT false,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.community_media_hearts (
  media_id UUID NOT NULL REFERENCES public.community_shared_media(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (media_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.community_user_blocks (
  blocker_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE TABLE IF NOT EXISTS public.community_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reported_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pack_id UUID REFERENCES public.community_packs(id) ON DELETE SET NULL,
  reason TEXT NOT NULL CHECK (reason IN ('unwanted_invitation', 'harassment', 'unsafe_content', 'other')),
  details TEXT CHECK (details IS NULL OR char_length(details) <= 1000),
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'reviewing', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (reporter_id <> reported_user_id)
);

CREATE TABLE IF NOT EXISTS public.community_username_lookups (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  looked_up_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS community_username_lookups_rate_idx
  ON public.community_username_lookups (user_id, looked_up_at DESC);

CREATE TABLE IF NOT EXISTS public.community_notification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('community_invite', 'community_walk_change', 'community_memory_ready')),
  pack_id UUID REFERENCES public.community_packs(id) ON DELETE CASCADE,
  walk_id UUID REFERENCES public.community_walks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  route TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS community_notification_events_user_idx
  ON public.community_notification_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS community_members_user_idx
  ON public.community_pack_members (user_id, joined_at DESC);
CREATE INDEX IF NOT EXISTS community_invitations_invitee_idx
  ON public.community_pack_invitations (invitee_id, state, created_at DESC);
CREATE INDEX IF NOT EXISTS community_invitations_claimed_idx
  ON public.community_pack_invitations (claimed_by, state);
CREATE INDEX IF NOT EXISTS community_walks_pack_idx
  ON public.community_walks (pack_id, scheduled_for DESC NULLS LAST, created_at DESC);
CREATE INDEX IF NOT EXISTS community_attendance_user_idx
  ON public.community_walk_attendance (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS community_shared_media_walk_idx
  ON public.community_shared_media (walk_id, captured_at);

-- SECURITY DEFINER membership helpers keep policies non-recursive. They return
-- booleans only and are not callable through the API.
CREATE OR REPLACE FUNCTION public.is_community_pack_member(p_pack_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.community_pack_members m
    WHERE m.pack_id = p_pack_id AND m.user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_community_pack_owner(p_pack_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.community_packs p
    WHERE p.id = p_pack_id AND p.owner_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_community_walk(p_walk_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.community_walks w
    JOIN public.community_pack_members m ON m.pack_id = w.pack_id
    WHERE w.id = p_walk_id AND m.user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.has_community_pack_invite(p_pack_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.community_pack_invitations i
    WHERE i.pack_id = p_pack_id
      AND (i.invitee_id = p_user_id OR i.claimed_by = p_user_id)
      AND i.state IN ('pending', 'pending_host')
      AND i.expires_at > now()
  );
$$;

REVOKE ALL ON FUNCTION public.is_community_pack_member(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_community_pack_owner(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_community_walk(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_community_pack_invite(UUID, UUID) FROM PUBLIC;

ALTER TABLE public.community_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_pack_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_pack_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_walks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_walk_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_walk_participant_pets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_walk_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_live_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_shared_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_media_hearts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_user_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_username_lookups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_notification_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY community_packs_read_members ON public.community_packs
  FOR SELECT TO authenticated
  USING (
    public.is_community_pack_member(id, (select auth.uid())) OR
    public.has_community_pack_invite(id, (select auth.uid()))
  );
CREATE POLICY community_packs_update_owner ON public.community_packs
  FOR UPDATE TO authenticated
  USING (owner_id = (select auth.uid()))
  WITH CHECK (owner_id = (select auth.uid()));

CREATE POLICY community_members_read_pack ON public.community_pack_members
  FOR SELECT TO authenticated
  USING (public.is_community_pack_member(pack_id, (select auth.uid())));
CREATE POLICY community_members_delete_owner ON public.community_pack_members
  FOR DELETE TO authenticated
  USING (public.is_community_pack_owner(pack_id, (select auth.uid())) AND role <> 'owner');
CREATE POLICY community_members_leave_self ON public.community_pack_members
  FOR DELETE TO authenticated
  USING (user_id = (select auth.uid()) AND role = 'member');

CREATE POLICY community_invites_read_involved ON public.community_pack_invitations
  FOR SELECT TO authenticated
  USING (
    inviter_id = (select auth.uid()) OR
    invitee_id = (select auth.uid()) OR
    claimed_by = (select auth.uid()) OR
    public.is_community_pack_owner(pack_id, (select auth.uid()))
  );

CREATE POLICY community_walks_read_members ON public.community_walks
  FOR SELECT TO authenticated
  USING (public.is_community_pack_member(pack_id, (select auth.uid())));
CREATE POLICY community_walks_update_organizer ON public.community_walks
  FOR UPDATE TO authenticated
  USING (organizer_id = (select auth.uid()))
  WITH CHECK (
    organizer_id = (select auth.uid()) AND
    public.is_community_pack_member(pack_id, (select auth.uid()))
  );

CREATE POLICY community_attendance_read_pack ON public.community_walk_attendance
  FOR SELECT TO authenticated
  USING (public.can_access_community_walk(walk_id, (select auth.uid())));
CREATE POLICY community_attendance_write_self ON public.community_walk_attendance
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid()) AND public.can_access_community_walk(walk_id, (select auth.uid())));
CREATE POLICY community_attendance_update_self ON public.community_walk_attendance
  FOR UPDATE TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()) AND public.can_access_community_walk(walk_id, (select auth.uid())));

CREATE POLICY community_walk_pets_read_pack ON public.community_walk_participant_pets
  FOR SELECT TO authenticated
  USING (public.can_access_community_walk(walk_id, (select auth.uid())));
CREATE POLICY community_walk_pets_write_self ON public.community_walk_participant_pets
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (select auth.uid()) AND
    public.can_access_community_walk(walk_id, (select auth.uid())) AND
    EXISTS (SELECT 1 FROM public.pets p WHERE p.id = pet_id AND p.owner_id = (select auth.uid()))
  );
CREATE POLICY community_walk_pets_delete_self ON public.community_walk_participant_pets
  FOR DELETE TO authenticated USING (user_id = (select auth.uid()));

CREATE POLICY community_walk_sessions_read_pack ON public.community_walk_sessions
  FOR SELECT TO authenticated
  USING (public.can_access_community_walk(walk_id, (select auth.uid())));
CREATE POLICY community_walk_sessions_write_self ON public.community_walk_sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (select auth.uid()) AND
    public.can_access_community_walk(walk_id, (select auth.uid())) AND
    EXISTS (SELECT 1 FROM public.pets p WHERE p.id = pet_id AND p.owner_id = (select auth.uid()))
  );

CREATE POLICY community_members_read_linked_personal_walks ON public.walk_sessions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.community_walk_sessions linked
      WHERE linked.walk_session_id = walk_sessions.id
        AND public.can_access_community_walk(linked.walk_id, (select auth.uid()))
    )
  );

-- Live positions are available only while the outing is active, and only to
-- members who are actually attending it. A stale row is still returned so the
-- client can say "Last updated…" rather than pretending it is current.
--
-- Attendance alone is not enough to read them. An attendance row outlives the
-- membership that produced it — removing someone from a pack deletes their
-- member row and nothing else — so without the membership check a removed
-- member would keep watching the walk they were just removed from. Every other
-- pack-scoped policy resolves through can_access_community_walk(), which is
-- membership-checked; these three say so themselves.
CREATE POLICY community_locations_read_attendees ON public.community_live_locations
  FOR SELECT TO authenticated
  USING (
    public.can_access_community_walk(walk_id, (select auth.uid())) AND
    EXISTS (
      SELECT 1 FROM public.community_walks w
      JOIN public.community_walk_attendance a ON a.walk_id = w.id
      WHERE w.id = walk_id
        AND w.state = 'active'
        AND a.user_id = (select auth.uid())
        AND a.status IN ('coming', 'checked_in', 'walking', 'finished')
    )
  );
CREATE POLICY community_locations_write_self ON public.community_live_locations
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (select auth.uid()) AND
    public.can_access_community_walk(walk_id, (select auth.uid())) AND
    EXISTS (
      SELECT 1 FROM public.community_walk_attendance a
      JOIN public.community_walks w ON w.id = a.walk_id
      WHERE a.walk_id = walk_id AND a.user_id = (select auth.uid())
        AND a.status = 'walking' AND a.share_location AND w.state = 'active'
    )
  );
CREATE POLICY community_locations_update_self ON public.community_live_locations
  FOR UPDATE TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (
    user_id = (select auth.uid()) AND
    public.can_access_community_walk(walk_id, (select auth.uid())) AND
    EXISTS (
      SELECT 1 FROM public.community_walk_attendance a
      JOIN public.community_walks w ON w.id = a.walk_id
      WHERE a.walk_id = walk_id AND a.user_id = (select auth.uid())
        AND a.status = 'walking' AND a.share_location AND w.state = 'active'
    )
  );

-- A person can see only the lightweight profiles and dogs of people who share
-- a private pack with them. Existing owner-only policies remain in place.
CREATE POLICY community_profiles_read_pack_members ON public.profiles
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.community_pack_members mine
      JOIN public.community_pack_members theirs ON theirs.pack_id = mine.pack_id
      WHERE mine.user_id = (select auth.uid()) AND theirs.user_id = profiles.id
    )
  );

CREATE POLICY community_profiles_read_memory_contributors ON public.profiles
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.community_shared_media media
      WHERE media.contributor_id = profiles.id
        AND media.removed_at IS NULL
        AND public.can_access_community_walk(media.walk_id, (select auth.uid()))
    )
  );

CREATE POLICY community_profiles_read_walk_contributors ON public.profiles
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.community_walk_sessions linked
      WHERE linked.user_id = profiles.id
        AND public.can_access_community_walk(linked.walk_id, (select auth.uid()))
    )
  );

CREATE POLICY community_pets_read_pack_members ON public.pets
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.community_pack_members mine
      JOIN public.community_pack_members theirs ON theirs.pack_id = mine.pack_id
      WHERE mine.user_id = (select auth.uid()) AND theirs.user_id = pets.owner_id
    )
  );

CREATE POLICY community_pets_read_memory_tags ON public.pets
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.community_shared_media media
      WHERE pets.id = ANY(media.dog_ids)
        AND media.removed_at IS NULL
        AND public.can_access_community_walk(media.walk_id, (select auth.uid()))
    )
  );

CREATE POLICY community_pets_read_walk_participants ON public.pets
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.community_walk_participant_pets participant
      WHERE participant.pet_id = pets.id
        AND public.can_access_community_walk(participant.walk_id, (select auth.uid()))
    )
  );

CREATE POLICY community_media_read_pack ON public.community_shared_media
  FOR SELECT TO authenticated
  USING (
    (public.can_access_community_walk(walk_id, (select auth.uid())) AND removed_at IS NULL) OR
    contributor_id = (select auth.uid())
  );
CREATE POLICY community_media_write_self ON public.community_shared_media
  FOR INSERT TO authenticated
  WITH CHECK (contributor_id = (select auth.uid()) AND public.can_access_community_walk(walk_id, (select auth.uid())));
CREATE POLICY community_media_update_self ON public.community_shared_media
  FOR UPDATE TO authenticated
  USING (contributor_id = (select auth.uid()))
  WITH CHECK (contributor_id = (select auth.uid()));

CREATE POLICY community_hearts_read_pack ON public.community_media_hearts
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.community_shared_media m
    WHERE m.id = media_id AND public.can_access_community_walk(m.walk_id, (select auth.uid()))
  ));
CREATE POLICY community_hearts_write_self ON public.community_media_hearts
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid()) AND EXISTS (
    SELECT 1 FROM public.community_shared_media m
    WHERE m.id = media_id AND public.can_access_community_walk(m.walk_id, (select auth.uid()))
  ));
CREATE POLICY community_hearts_delete_self ON public.community_media_hearts
  FOR DELETE TO authenticated USING (user_id = (select auth.uid()));

CREATE POLICY community_blocks_manage_self ON public.community_user_blocks
  FOR ALL TO authenticated
  USING (blocker_id = (select auth.uid()))
  WITH CHECK (blocker_id = (select auth.uid()));
CREATE POLICY community_reports_insert_self ON public.community_reports
  FOR INSERT TO authenticated
  WITH CHECK (reporter_id = (select auth.uid()));
CREATE POLICY community_reports_read_self ON public.community_reports
  FOR SELECT TO authenticated
  USING (reporter_id = (select auth.uid()));

CREATE POLICY community_notification_events_read_self ON public.community_notification_events
  FOR SELECT TO authenticated USING (user_id = (select auth.uid()));

CREATE OR REPLACE FUNCTION public.enqueue_community_notification(
  p_user_id UUID,
  p_event_type TEXT,
  p_pack_id UUID,
  p_walk_id UUID,
  p_title TEXT,
  p_body TEXT,
  p_route TEXT,
  p_dedupe_key TEXT
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.community_notification_events
    (user_id, event_type, pack_id, walk_id, title, body, route, dedupe_key)
  VALUES
    (p_user_id, p_event_type, p_pack_id, p_walk_id, p_title, p_body, p_route, p_dedupe_key)
  ON CONFLICT (dedupe_key) DO NOTHING;
$$;
REVOKE ALL ON FUNCTION public.enqueue_community_notification(UUID, TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;

-- Exact username lookup returns only the identity needed to confirm a person
-- the caller already knows. There is no prefix search or directory.
CREATE OR REPLACE FUNCTION public.lookup_community_username(p_username TEXT)
RETURNS TABLE (
  user_id UUID,
  username TEXT,
  full_name TEXT,
  avatar_url TEXT,
  dogs JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_username TEXT := lower(trim(leading '@' from trim(coalesce(p_username, ''))));
BEGIN
  IF auth.uid() IS NULL OR v_username !~ '^[a-z0-9_]{3,24}$' THEN
    RETURN;
  END IF;
  IF (SELECT count(*) FROM public.community_username_lookups
      WHERE user_id = auth.uid() AND looked_up_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'username_lookup_rate_limited';
  END IF;
  INSERT INTO public.community_username_lookups (user_id) VALUES (auth.uid());
  RETURN QUERY
  SELECT pr.id, pr.username, pr.full_name, pr.avatar_url,
    coalesce(jsonb_agg(jsonb_build_object('id', pet.id, 'name', pet.name, 'image_url', pet.image_url))
      FILTER (WHERE pet.id IS NOT NULL), '[]'::jsonb)
  FROM public.profiles pr
  LEFT JOIN public.pets pet ON pet.owner_id = pr.id AND pet.species = 'dog'
  WHERE lower(pr.username) = v_username AND pr.id <> auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM public.community_user_blocks b
      WHERE (b.blocker_id = auth.uid() AND b.blocked_id = pr.id)
         OR (b.blocker_id = pr.id AND b.blocked_id = auth.uid())
    )
  GROUP BY pr.id, pr.username, pr.full_name, pr.avatar_url;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_community_pack(p_name TEXT)
RETURNS public.community_packs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_owner UUID := auth.uid(); v_pack public.community_packs;
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  INSERT INTO public.community_packs (name, owner_id)
  VALUES (trim(p_name), v_owner) RETURNING * INTO v_pack;
  INSERT INTO public.community_pack_members (pack_id, user_id, role, archive_from)
  VALUES (v_pack.id, v_owner, 'owner', '-infinity');
  RETURN v_pack;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_community_invitations()
RETURNS TABLE (
  invitation_id UUID,
  pack_id UUID,
  invite_code UUID,
  state TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  pack_name TEXT,
  inviter_id UUID,
  inviter_name TEXT,
  inviter_username TEXT,
  dogs JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.id, i.pack_id, i.invite_code, i.state, i.expires_at, i.created_at,
    pack.name, i.inviter_id, inviter.full_name, inviter.username,
    coalesce(jsonb_agg(DISTINCT jsonb_build_object('id', pet.id, 'name', pet.name, 'image_url', pet.image_url))
      FILTER (WHERE pet.id IS NOT NULL), '[]'::jsonb)
  FROM public.community_pack_invitations i
  JOIN public.community_packs pack ON pack.id = i.pack_id
  JOIN public.profiles inviter ON inviter.id = i.inviter_id
  LEFT JOIN public.community_pack_members member ON member.pack_id = i.pack_id
  LEFT JOIN public.pets pet ON pet.owner_id = member.user_id AND pet.species = 'dog'
  WHERE i.invitee_id = auth.uid() AND i.state = 'pending' AND i.expires_at > now()
  GROUP BY i.id, i.pack_id, i.invite_code, i.state, i.expires_at, i.created_at,
    pack.name, i.inviter_id, inviter.full_name, inviter.username
  ORDER BY i.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.invite_community_username(p_pack_id UUID, p_username TEXT)
RETURNS public.community_pack_invitations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inviter UUID := auth.uid();
  v_invitee UUID;
  v_invite public.community_pack_invitations;
  v_recent INTEGER;
BEGIN
  IF NOT public.is_community_pack_member(p_pack_id, v_inviter) THEN RAISE EXCEPTION 'pack_access_denied'; END IF;
  SELECT id INTO v_invitee FROM public.profiles
    WHERE lower(username) = lower(trim(leading '@' from trim(p_username)));
  IF v_invitee IS NULL OR v_invitee = v_inviter THEN RAISE EXCEPTION 'username_not_found'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.community_user_blocks b
    WHERE (b.blocker_id = v_inviter AND b.blocked_id = v_invitee)
       OR (b.blocker_id = v_invitee AND b.blocked_id = v_inviter)
  ) THEN RAISE EXCEPTION 'username_not_found'; END IF;
  IF public.is_community_pack_member(p_pack_id, v_invitee) THEN RAISE EXCEPTION 'already_a_member'; END IF;
  SELECT count(*) INTO v_recent FROM public.community_pack_invitations
    WHERE inviter_id = v_inviter AND created_at > now() - interval '1 hour';
  IF v_recent >= 12 THEN RAISE EXCEPTION 'invite_rate_limited'; END IF;
  SELECT * INTO v_invite FROM public.community_pack_invitations
    WHERE pack_id = p_pack_id AND invitee_id = v_invitee AND state = 'pending' AND expires_at > now()
    ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN RETURN v_invite; END IF;
  INSERT INTO public.community_pack_invitations (pack_id, inviter_id, invitee_id)
    VALUES (p_pack_id, v_inviter, v_invitee) RETURNING * INTO v_invite;
  PERFORM public.enqueue_community_notification(
    v_invitee,
    'community_invite',
    p_pack_id,
    NULL,
    coalesce((SELECT full_name FROM public.profiles WHERE id = v_inviter), 'A friend') || ' invited you',
    'Meet the dogs in ' || (SELECT name FROM public.community_packs WHERE id = p_pack_id) || ' and decide whether to join.',
    '/(tabs)/community',
    'community_invite:' || v_invite.id::TEXT
  );
  RETURN v_invite;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_external_community_invite(p_pack_id UUID)
RETURNS public.community_pack_invitations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_inviter UUID := auth.uid(); v_invite public.community_pack_invitations;
BEGIN
  IF NOT public.is_community_pack_member(p_pack_id, v_inviter) THEN RAISE EXCEPTION 'pack_access_denied'; END IF;
  INSERT INTO public.community_pack_invitations (pack_id, inviter_id)
    VALUES (p_pack_id, v_inviter) RETURNING * INTO v_invite;
  RETURN v_invite;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_external_community_invite(p_code UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user UUID := auth.uid(); v_invite public.community_pack_invitations;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  SELECT * INTO v_invite FROM public.community_pack_invitations
    WHERE invite_code = p_code AND invitee_id IS NULL AND state = 'pending' AND expires_at > now()
    FOR UPDATE;
  IF NOT FOUND THEN RETURN 'invalid_or_expired'; END IF;
  UPDATE public.community_pack_invitations
    SET claimed_by = v_user, state = 'pending_host', responded_at = now()
    WHERE id = v_invite.id;
  RETURN 'host_confirmation_required';
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_community_invitation(p_invitation_id UUID, p_accept BOOLEAN)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user UUID := auth.uid(); v_invite public.community_pack_invitations;
BEGIN
  SELECT * INTO v_invite FROM public.community_pack_invitations
    WHERE id = p_invitation_id AND invitee_id = v_user AND state = 'pending' AND expires_at > now()
    FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_available'; END IF;
  IF p_accept THEN
    INSERT INTO public.community_pack_members (pack_id, user_id, role, archive_from)
      VALUES (v_invite.pack_id, v_user, 'member', now()) ON CONFLICT DO NOTHING;
    UPDATE public.community_pack_invitations SET state = 'accepted', responded_at = now() WHERE id = v_invite.id;
    RETURN 'accepted';
  END IF;
  UPDATE public.community_pack_invitations SET state = 'declined', responded_at = now() WHERE id = v_invite.id;
  RETURN 'declined';
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_external_community_invite(p_invitation_id UUID, p_approve BOOLEAN)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_owner UUID := auth.uid(); v_invite public.community_pack_invitations;
BEGIN
  SELECT * INTO v_invite FROM public.community_pack_invitations
    WHERE id = p_invitation_id AND state = 'pending_host' FOR UPDATE;
  IF NOT FOUND OR NOT public.is_community_pack_owner(v_invite.pack_id, v_owner) THEN RETURN 'not_available'; END IF;
  IF p_approve AND v_invite.claimed_by IS NOT NULL THEN
    INSERT INTO public.community_pack_members (pack_id, user_id, role, archive_from)
      VALUES (v_invite.pack_id, v_invite.claimed_by, 'member', now()) ON CONFLICT DO NOTHING;
    UPDATE public.community_pack_invitations SET invitee_id = claimed_by, state = 'accepted', responded_at = now()
      WHERE id = v_invite.id;
    RETURN 'accepted';
  END IF;
  UPDATE public.community_pack_invitations SET state = 'revoked', responded_at = now() WHERE id = v_invite.id;
  RETURN 'revoked';
END;
$$;

CREATE OR REPLACE FUNCTION public.list_external_community_claims(p_pack_id UUID)
RETURNS TABLE (
  invitation_id UUID,
  claimant_id UUID,
  username TEXT,
  full_name TEXT,
  avatar_url TEXT,
  dogs JSONB,
  claimed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_community_pack_owner(p_pack_id, auth.uid()) THEN
    RAISE EXCEPTION 'pack_owner_required';
  END IF;
  RETURN QUERY
  SELECT i.id, i.claimed_by, pr.username, pr.full_name, pr.avatar_url,
    coalesce(jsonb_agg(jsonb_build_object('id', pet.id, 'name', pet.name, 'image_url', pet.image_url))
      FILTER (WHERE pet.id IS NOT NULL), '[]'::jsonb),
    i.responded_at
  FROM public.community_pack_invitations i
  JOIN public.profiles pr ON pr.id = i.claimed_by
  LEFT JOIN public.pets pet ON pet.owner_id = i.claimed_by AND pet.species = 'dog'
  WHERE i.pack_id = p_pack_id AND i.state = 'pending_host'
  GROUP BY i.id, i.claimed_by, pr.username, pr.full_name, pr.avatar_url, i.responded_at
  ORDER BY i.created_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_community_walk(
  p_pack_id UUID,
  p_title TEXT,
  p_scheduled_for TIMESTAMPTZ,
  p_meeting_label TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS public.community_walks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user UUID := auth.uid(); v_walk public.community_walks;
BEGIN
  IF NOT public.is_community_pack_member(p_pack_id, v_user) THEN RAISE EXCEPTION 'pack_access_denied'; END IF;
  INSERT INTO public.community_walks (pack_id, organizer_id, title, scheduled_for, meeting_label, note)
    VALUES (p_pack_id, v_user, trim(p_title), p_scheduled_for, trim(p_meeting_label), nullif(trim(p_note), ''))
    RETURNING * INTO v_walk;
  INSERT INTO public.community_walk_attendance (walk_id, user_id, status)
    VALUES (v_walk.id, v_user, 'coming');
  PERFORM public.enqueue_community_notification(
    member.user_id,
    'community_walk_change',
    p_pack_id,
    v_walk.id,
    (SELECT name FROM public.community_packs WHERE id = p_pack_id) || ' has a new walk',
    trim(p_title) || ' · ' || trim(p_meeting_label),
    '/community/walk/' || v_walk.id::TEXT,
    'community_walk_created:' || v_walk.id::TEXT || ':' || member.user_id::TEXT
  )
  FROM public.community_pack_members member
  WHERE member.pack_id = p_pack_id AND member.user_id <> v_user;
  RETURN v_walk;
END;
$$;

CREATE OR REPLACE FUNCTION public.on_community_walk_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_type TEXT; v_title TEXT; v_body TEXT;
BEGIN
  IF NEW.state = 'completed' AND OLD.state IS DISTINCT FROM NEW.state THEN
    v_type := 'community_memory_ready';
    v_title := 'Your pack memory is ready';
    v_body := NEW.title || ' is waiting on the pack shelf.';
  ELSIF OLD.scheduled_for IS DISTINCT FROM NEW.scheduled_for
     OR OLD.meeting_label IS DISTINCT FROM NEW.meeting_label
     OR OLD.note IS DISTINCT FROM NEW.note
     OR OLD.state IS DISTINCT FROM NEW.state THEN
    v_type := 'community_walk_change';
    v_title := 'A pack walk changed';
    v_body := NEW.title || ' · ' || NEW.meeting_label;
  ELSE
    RETURN NEW;
  END IF;

  PERFORM public.enqueue_community_notification(
    member.user_id,
    v_type,
    NEW.pack_id,
    NEW.id,
    v_title,
    v_body,
    CASE WHEN v_type = 'community_memory_ready'
      THEN '/community/walk/' || NEW.id::TEXT || '/memory'
      ELSE '/community/walk/' || NEW.id::TEXT END,
    v_type || ':' || NEW.id::TEXT || ':' || NEW.updated_at::TEXT || ':' || member.user_id::TEXT
  )
  FROM public.community_pack_members member
  WHERE member.pack_id = NEW.pack_id AND member.user_id <> coalesce(auth.uid(), NEW.organizer_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS community_walk_changed_notify ON public.community_walks;
CREATE TRIGGER community_walk_changed_notify
  AFTER UPDATE ON public.community_walks
  FOR EACH ROW EXECUTE FUNCTION public.on_community_walk_changed();

CREATE OR REPLACE FUNCTION public.get_community_notification_candidates()
RETURNS TABLE (
  event_id UUID,
  user_id UUID,
  event_type TEXT,
  title TEXT,
  body TEXT,
  route TEXT,
  dedupe_key TEXT,
  timezone TEXT,
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  tokens TEXT[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH live_tokens AS (
    SELECT token.user_id, array_agg(token.token ORDER BY token.last_seen_at DESC NULLS LAST) AS tokens
    FROM public.push_tokens token
    WHERE token.disabled_at IS NULL AND token.token LIKE 'ExponentPushToken%'
    GROUP BY token.user_id
  )
  SELECT event.id, event.user_id, event.event_type, event.title, event.body, event.route,
    event.dedupe_key, profile.timezone, prefs.quiet_hours_start, prefs.quiet_hours_end, live.tokens
  FROM public.community_notification_events event
  JOIN public.profiles profile ON profile.id = event.user_id
  JOIN live_tokens live ON live.user_id = event.user_id
  LEFT JOIN public.owner_preferences prefs ON prefs.owner_id = event.user_id
  LEFT JOIN public.community_pack_members membership
    ON membership.pack_id = event.pack_id AND membership.user_id = event.user_id
  WHERE event.created_at > now() - interval '28 days'
    AND coalesce(prefs.push_enabled, true)
    AND coalesce(membership.notifications_muted, false) = false
    AND NOT EXISTS (
      SELECT 1 FROM public.notification_history history
      WHERE history.dedupe_key = event.dedupe_key
    )
  ORDER BY event.created_at
  LIMIT 500;
$$;
REVOKE ALL ON FUNCTION public.get_community_notification_candidates() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.transfer_community_pack_ownership(p_pack_id UUID, p_new_owner_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_owner UUID := auth.uid();
BEGIN
  IF NOT public.is_community_pack_owner(p_pack_id, v_owner) THEN RAISE EXCEPTION 'pack_owner_required'; END IF;
  IF NOT public.is_community_pack_member(p_pack_id, p_new_owner_id) THEN RAISE EXCEPTION 'new_owner_must_be_member'; END IF;
  UPDATE public.community_pack_members SET role = 'member' WHERE pack_id = p_pack_id AND user_id = v_owner;
  UPDATE public.community_pack_members SET role = 'owner' WHERE pack_id = p_pack_id AND user_id = p_new_owner_id;
  UPDATE public.community_packs SET owner_id = p_new_owner_id, updated_at = now() WHERE id = p_pack_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_community_pack_muted(p_pack_id UUID, p_muted BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_community_pack_member(p_pack_id, auth.uid()) THEN RAISE EXCEPTION 'pack_access_denied'; END IF;
  UPDATE public.community_pack_members
    SET notifications_muted = p_muted
    WHERE pack_id = p_pack_id AND user_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_community_username(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_community_pack(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_community_invitations() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invite_community_username(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_external_community_invite(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_external_community_invite(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.respond_community_invitation(UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_external_community_invite(UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_external_community_claims(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_community_walk(UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transfer_community_pack_ownership(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_community_pack_muted(UUID, BOOLEAN) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.lookup_community_username(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_community_pack(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_community_invitations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_community_username(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_external_community_invite(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_external_community_invite(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_community_invitation(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_external_community_invite(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_external_community_claims(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_community_walk(UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_community_pack_ownership(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_community_pack_muted(UUID, BOOLEAN) TO authenticated;

GRANT SELECT, UPDATE ON public.community_packs TO authenticated;
GRANT SELECT, DELETE ON public.community_pack_members TO authenticated;
GRANT SELECT ON public.community_pack_invitations TO authenticated;
GRANT SELECT, UPDATE ON public.community_walks TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.community_walk_attendance TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.community_walk_participant_pets TO authenticated;
GRANT SELECT, INSERT ON public.community_walk_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.community_live_locations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.community_shared_media TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.community_media_hearts TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.community_user_blocks TO authenticated;
GRANT SELECT, INSERT ON public.community_reports TO authenticated;
GRANT SELECT ON public.community_notification_events TO authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE public.community_live_locations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.community_walk_attendance;

-- Display-quality copies are a new, explicit capability. The bucket is private
-- and its first path segment is always the outing id; storage policies reuse
-- the same pack access check as the memory rows.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('community-walk-media', 'community-walk-media', false, 5242880, ARRAY['image/jpeg'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY community_media_objects_read_pack ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'community-walk-media' AND
    public.can_access_community_walk(((storage.foldername(name))[1])::UUID, (select auth.uid()))
  );
CREATE POLICY community_media_objects_insert_self ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'community-walk-media' AND
    ((storage.foldername(name))[2])::UUID = (select auth.uid()) AND
    public.can_access_community_walk(((storage.foldername(name))[1])::UUID, (select auth.uid()))
  );
CREATE POLICY community_media_objects_update_self ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'community-walk-media' AND
    ((storage.foldername(name))[2])::UUID = (select auth.uid())
  );
CREATE POLICY community_media_objects_delete_self ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'community-walk-media' AND
    ((storage.foldername(name))[2])::UUID = (select auth.uid())
  );

COMMENT ON TABLE public.community_packs IS 'Invitation-only persistent groups of owners who already know each other.';
COMMENT ON TABLE public.community_live_locations IS 'Latest explicitly shared owner-phone location per active outing; never a dog GPS claim.';
COMMENT ON COLUMN public.community_shared_media.display_path IS 'Access-controlled display-quality copy. Existing walk_media thumbnails are not sufficient for a shared memory.';
