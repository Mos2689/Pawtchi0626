-- Restore the participant-pet policy that existed before this fix.

DROP POLICY IF EXISTS community_walk_pets_write_self
  ON public.community_walk_participant_pets;

CREATE POLICY community_walk_pets_write_self
  ON public.community_walk_participant_pets
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND public.can_access_community_walk(walk_id, (SELECT auth.uid()))
    AND EXISTS (
      SELECT 1
      FROM public.pets p
      WHERE p.id = pet_id
        AND p.owner_id = (SELECT auth.uid())
    )
  );

DROP FUNCTION IF EXISTS public.is_community_pet_owner(UUID);

