-- Step 5 — BCS 8/9 vet-consult gate.
--
-- A BCS of 8 or 9 (clinically obese) means the dog needs vet-supervised
-- weight loss with bloodwork before any restricted-calorie plan. AAHA + WSAVA
-- guidelines explicitly: these pets often have undiagnosed comorbidities
-- (hypothyroidism, Cushing's) that change the prescription.
--
-- We gate the build-plan CTA in onboarding behind a confirmation checkbox,
-- and we store the timestamp so we can also surface a persistent home-tab
-- banner whenever the column is null and bcs >= 8.

ALTER TABLE pets
  ADD COLUMN IF NOT EXISTS severe_obesity_vet_confirmed_at TIMESTAMP WITH TIME ZONE;

-- Reproductive status for intact females. Pregnant ≈ 1.25× maintenance in last
-- third; lactating 2–4× depending on litter size. We don't try to auto-adjust
-- kcal precisely — we flag the profile so the reveal screen and home banner
-- can say "this plan is a starting point; please confirm with your vet."

ALTER TABLE pets
  ADD COLUMN IF NOT EXISTS reproductive_status TEXT
    CHECK (reproductive_status IN ('pregnant', 'nursing', 'neither'));
