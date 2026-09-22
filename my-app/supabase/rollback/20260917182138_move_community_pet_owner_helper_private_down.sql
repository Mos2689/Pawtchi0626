-- Restore the public helper state created by the preceding migration.

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

DROP FUNCTION IF EXISTS private.is_community_pet_owner(UUID);
