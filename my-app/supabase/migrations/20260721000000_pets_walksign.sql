-- Walksigns — the identity Pawtchi discovers from how a dog moves through
-- the world. Provisional at onboarding (derived from life stage, energy,
-- first-dog), confirmed by real tracked walks, and changed only at life
-- transitions (puppy graduation, seniority). Dogs only; cat rows keep NULLs.
ALTER TABLE pets ADD COLUMN IF NOT EXISTS walksign text
  CHECK (walksign IN (
    'newbond', 'loopkeeper', 'blockscout', 'packheart',
    'softstep', 'storywalker', 'wonderbound'
  ));
ALTER TABLE pets ADD COLUMN IF NOT EXISTS walksign_status text
  CHECK (walksign_status IN ('provisional', 'confirmed'));
ALTER TABLE pets ADD COLUMN IF NOT EXISTS walksign_assigned_at timestamptz;

-- Append-only history of every assignment/confirmation/transition:
-- [{ "sign": ..., "status": ..., "reason": ..., "at": ISO }] — powers
-- future "then and now" stories and Years in Review.
ALTER TABLE pets ADD COLUMN IF NOT EXISTS walksign_history jsonb
  NOT NULL DEFAULT '[]'::jsonb;

-- The one new onboarding fact: Newbond (the dog who made you a dog person)
-- is only assignable when we know this is the owner's first dog. Nullable —
-- the question is skippable and older profiles never answered it.
ALTER TABLE pets ADD COLUMN IF NOT EXISTS first_dog boolean;

-- Phase-2 community pages count members per sign ("The Wonderbounds —
-- 12,480 dogs…"); the index makes that aggregate cheap from day one.
CREATE INDEX IF NOT EXISTS idx_pets_walksign ON pets (walksign)
  WHERE walksign IS NOT NULL;
