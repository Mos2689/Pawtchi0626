/**
 * petProfile — creating a pet row, and filling it in later.
 *
 * Pawtchi used to create the pet exactly once, on the seventh onboarding
 * screen, because every screen before it fed the same calorie calculation.
 * Walk needs none of that: a dog with a name can record a walk. So dogs now get
 * a row after step two and enter the app, and the health fields arrive later
 * through the completion flow.
 *
 * That splits pet setup into two operations which must stay distinct:
 *
 *   createLightweightPet — the minimum a walk needs. Dogs, at step two.
 *   (goal.tsx)           — the full health profile, which now INSERTs when no
 *                          row exists (cats, and the full dog path) and UPDATEs
 *                          when one does (a dog returning through completion).
 *
 * The health columns a lightweight row leaves unset are what
 * lib/health/featureRequirements.ts reads to decide whether a health feature
 * can run. They are deliberately empty, not defaulted — a plausible-looking
 * zero would let Meal render a confident 0 kcal target.
 */

import { supabase } from '../supabase';
import { deriveLifeStage } from '../lifeStage';
import { deriveProvisionalWalksign } from '../walksign/walksignEngine';
import { petFallbackImage } from '../petFallbackImage';

/**
 * Weight sentinel for a pet whose owner has not weighed them yet.
 *
 * Not a stylistic choice — `current_weight_kg NUMERIC(5,2) NOT NULL` in
 * supabase/schema.sql, so the row cannot be created without a number. 0 is the
 * one value that cannot be mistaken for a measurement, and every consumer that
 * matters already treats a non-positive weight as absent (`computeCompleteness`
 * requires `> 0`, and so does `featureRequirements`).
 *
 * The rule that keeps this honest: nothing may show a number derived from
 * weight until the health gate says the field is present.
 *
 * The full NOT NULL set on `pets` is owner_id, name, species,
 * current_weight_kg, and weight_plan_revision (which defaults). A lightweight
 * row supplies all of them.
 */
export const WEIGHT_UNSET = 0;

export interface LightweightPetInput {
  ownerId: string;
  species: 'dog' | 'cat';
  name: string;
  /** Free text; null when the owner skipped it. */
  breed: string | null;
  /** Decimal years (years + months/12). Null when unknown. */
  ageYears: number | null;
  /** Already-uploaded public URL, or null to fall back to the stock image. */
  imageUrl: string | null;
  firstDog: boolean | null;
  householdWalkers: number | null;
}

/**
 * The row a walk-ready pet needs, and nothing more.
 *
 * Exported separately from the insert so it can be asserted in tests without a
 * database — the set of columns this writes IS the contract with the health
 * gate, and a field quietly added here would silently un-gate a feature.
 */
export function buildLightweightPetRow(input: LightweightPetInput): Record<string, unknown> {
  const breed = input.breed?.trim() || null;
  const ageYears = input.ageYears != null && input.ageYears > 0 ? input.ageYears : null;

  // The first Walksign reading. Life stage falls back to adult when age is
  // unknown, which is what makes this provisional rather than final — five
  // valid walks re-derive it from behaviour (lib/walksign/walksignEngine.ts).
  const lifeStage = deriveLifeStage(input.species, ageYears ?? 3, 0);
  const walksign = deriveProvisionalWalksign({
    species: input.species,
    lifeStage,
    firstDog: input.firstDog,
    householdWalkers: input.householdWalkers,
    ownershipMonths: 0,
    activityLevel: 'normal',
  });
  const nowIso = new Date().toISOString();

  return {
    owner_id: input.ownerId,
    name: input.name.trim() || 'My Pet',
    species: input.species,
    breed,
    age_years: ageYears,
    image_url: input.imageUrl || petFallbackImage(input.species, 1000),

    // Health fields intentionally left unwritten, so they stay NULL and the
    // gate can read their absence: activity_level, gender, body_condition_score,
    // target_daily_calories, allergies, and the whole weight-plan block.
    // `is_neutered` is the one exception — it carries DEFAULT TRUE in the
    // schema, so it will read as true whether or not anyone said so. Nothing
    // may treat it as answered until the health profile is complete.
    current_weight_kg: WEIGHT_UNSET,

    // Spread-conditional, matching the pattern in goal.tsx: keeps the insert
    // working on projects where the walksign migration has not been applied.
    ...(walksign
      ? {
          walksign: walksign.sign,
          walksign_status: walksign.status,
          walksign_assigned_at: nowIso,
          walksign_history: [
            { sign: walksign.sign, status: walksign.status, reason: walksign.reason, at: nowIso },
          ],
          first_dog: input.firstDog,
          ...(input.householdWalkers != null
            ? { household_walkers: input.householdWalkers }
            : {}),
        }
      : {}),
  };
}

export interface CreatePetResult {
  petId: string | null;
  error: unknown | null;
  /** The sign stamped at creation, for the caller's analytics. */
  walksign: string | null;
}

/** Create the walk-ready row and return its id. */
export async function createLightweightPet(
  input: LightweightPetInput,
): Promise<CreatePetResult> {
  const row = buildLightweightPetRow(input);
  const { data, error } = await supabase
    .from('pets')
    .insert(row)
    .select('id')
    .single();

  return {
    petId: data?.id ?? null,
    error: error ?? null,
    walksign: (row.walksign as string | undefined) ?? null,
  };
}

/**
 * Upload an onboarding photo and return its public URL.
 *
 * Lifted out of goal.tsx so the lightweight path can use the identical upload
 * rather than growing a second one that drifts. A failure is non-fatal by
 * design: a pet with a stock image is a working pet, and losing the whole
 * signup because a photo upload timed out would be the worse outcome.
 */
export async function uploadPetAvatar(
  userId: string,
  imageUri: string | null,
): Promise<string | null> {
  if (!imageUri) return null;
  try {
    const ext = imageUri.substring(imageUri.lastIndexOf('.') + 1) || 'jpg';
    const fileName = `${userId}_${Date.now()}.${ext}`;

    // React Native's FormData accepts a {uri,name,type} part, which the DOM
    // typings don't describe. Cast through `any` rather than naming a DOM type
    // like Blob — referencing one here drags the whole DOM lib into scope and
    // its `Image` global then shadows React Native's in unrelated files.
    const formData = new FormData();
    formData.append('file', {
      uri: imageUri,
      name: fileName,
      type: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
    } as any);

    const { data, error } = await supabase.storage.from('avatars').upload(fileName, formData);
    if (error || !data) return null;

    return supabase.storage.from('avatars').getPublicUrl(fileName).data.publicUrl;
  } catch {
    return null;
  }
}
