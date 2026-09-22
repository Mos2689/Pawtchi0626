-- Break the participant-pet INSERT policy's recursive RLS chain.
--
-- The original policy proved pet ownership with a SELECT from public.pets.
-- That SELECT evaluates every permissive pet-read policy, including
-- community_pets_read_walk_participants, which reads
-- community_walk_participant_pets again. PostgreSQL therefore re-enters the
-- relation whose INSERT policy it is already evaluating and raises 42P17.

CREATE OR REPLACE FUNCTION public.is_community_pet_owner(p_pet_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.pets p
    WHERE p.id = p_pet_id
      AND p.owner_id = auth.uid()
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_community_pet_owner(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_community_pet_owner(UUID) TO authenticated;

DROP POLICY IF EXISTS community_walk_pets_write_self
  ON public.community_walk_participant_pets;

CREATE POLICY community_walk_pets_write_self
  ON public.community_walk_participant_pets
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND public.can_access_community_walk(walk_id, (SELECT auth.uid()))
    AND public.is_community_pet_owner(pet_id)
  );

