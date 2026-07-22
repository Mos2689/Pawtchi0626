/**
 * Fire-and-forget photo BCS estimate — network half of the suggestion flow.
 *
 * Kicked off when body-basics completes (weight/breed/age are now known and
 * the goal screen is still two steps away), so by the time the owner reaches
 * the body-shape picker the read is usually already waiting in the store.
 * The gating/mapping half lives in `bcsPhotoEstimate.ts` (pure, jest-tested)
 * and runs at display time on the goal screen.
 *
 * Contract: NEVER blocks or throws into the onboarding flow. Every failure
 * path lands on status 'unavailable', which the goal screen renders as
 * exactly the picker we ship today — the feature fails silent.
 */

import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import { supabase } from './supabase';
import { withTimeout } from './withTimeout';
import { track } from './analytics';
import { usePetStore } from '../store/usePetStore';
import { getBreedDefaults } from './breedData';
import { adultAgeMonths } from './idealWeight';
import type { BcsPhotoEstimateRaw } from './bcsPhotoEstimate';

const ESTIMATE_TIMEOUT_MS = 45_000;
// Matches imagePrep's upload budget — the avatar was downscaled at pick time.
const JPEG_QUALITY = 0.7;

export async function startBcsPhotoEstimate(): Promise<void> {
  const store = usePetStore.getState();
  const { imageUri, species } = store;

  if (!imageUri) return;
  // Same photo already analyzed (or in flight) — don't burn a second call.
  if (store.bcsPhotoSourceUri === imageUri && store.bcsPhotoStatus !== 'idle') return;

  const speciesVal = species === 'cat' ? ('cat' as const) : ('dog' as const);
  const weightKg = parseFloat(store.weight) || null;
  const totalAgeMonths = (parseInt(store.ageYears) || 0) * 12 + (parseInt(store.ageMonths) || 0);

  // Growth gate — puppies/kittens don't get an adult-style ideal weight, so a
  // body-condition suggestion has nothing downstream to feed. Skip the call.
  const size = getBreedDefaults(speciesVal, store.breed, weightKg)?.sizeCategory;
  if (totalAgeMonths > 0 && totalAgeMonths < adultAgeMonths(speciesVal, size)) return;

  store.setBcsPhotoEstimate({ status: 'pending', raw: null, sourceUri: imageUri });
  track('bcs_photo_estimate_requested', {
    species: speciesVal,
    breed: store.breed || null,
    weight_kg: weightKg,
  });

  try {
    // The avatar was downscaled at pick time but only its uri persists —
    // re-encode to get base64 for the wire. Cheap: the file is already small.
    const encoded = await manipulateAsync(imageUri, [], {
      compress: JPEG_QUALITY,
      format: SaveFormat.JPEG,
      base64: true,
    });
    if (!encoded?.base64) throw new Error('Could not read photo data.');

    const { data, error } = await withTimeout(
      supabase.functions.invoke('estimate-bcs', {
        body: {
          imageBase64: encoded.base64,
          mimeType: 'image/jpeg',
          species: speciesVal,
          breed: store.breed || null,
          sex: store.gender,
          ageMonths: totalAgeMonths || null,
          weightKg,
        },
      }),
      ESTIMATE_TIMEOUT_MS,
      'estimate-bcs',
    );
    if (error) throw error;
    if (!data?.success || !data.estimate) throw new Error(data?.error || 'No estimate returned');

    const raw = data.estimate as BcsPhotoEstimateRaw;

    // The photo may have been swapped while the call was in flight — a stale
    // read must not decorate the new photo's picker.
    if (usePetStore.getState().imageUri !== imageUri) return;

    usePetStore.getState().setBcsPhotoEstimate({ status: 'ready', raw, sourceUri: imageUri });
    track('bcs_photo_estimate_returned', {
      pet_visible: raw.pet_visible,
      full_body_visible: raw.full_body_visible,
      is_side_profile: raw.is_side_profile,
      is_standing: raw.is_standing,
      coat_length: raw.coat_length,
      bcs_low: raw.bcs_low,
      bcs_high: raw.bcs_high,
      confidence: raw.confidence,
      quality_issues: raw.photo_quality_issues.join(', ') || null,
    });
  } catch (err: any) {
    if (usePetStore.getState().imageUri === imageUri) {
      usePetStore.getState().setBcsPhotoEstimate({ status: 'unavailable', raw: null, sourceUri: imageUri });
    }
    track('bcs_photo_estimate_failed', { reason: err?.message || 'unknown' });
  }
}
