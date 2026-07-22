-- Hands-on check calibration data: the raw questionnaire answers plus the
-- scored outcome (band, conflict flag, confidence tier, photo agreement).
-- Written alongside body_condition_score when bcs_source = 'guided_check';
-- null for quick-pick / photo-confirmed scores. Shape documented in
-- lib/bcsCheck.ts (BcsCheckRecord).
alter table public.pets
  add column if not exists bcs_check_answers jsonb;

-- Widen the bcs_source provenance set with 'guided_check' — the score came
-- from the hands-on questionnaire (fused with the photo band when present).
alter table public.pets
  drop constraint if exists pets_bcs_source_check;
alter table public.pets
  add constraint pets_bcs_source_check
  check (bcs_source in ('owner', 'ai_confirmed', 'ai_overridden', 'vet_report', 'guided_check'));
