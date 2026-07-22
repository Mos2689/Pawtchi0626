// Species-aware placeholder photo for a pet with no user-uploaded image.
//
// Onboarding doesn't force a photo, so screens need a stand-in. The old code
// hard-coded a single dog photo everywhere — which showed a dog on cat
// profiles. This picks the right animal from species, and (via resolvePetImage)
// also rescues profiles that already have the old dog placeholder saved in
// image_url: any unsplash URL is a placeholder, so we re-derive the correct
// one at render time rather than trusting the stored value.
//
// Both URLs are unsplash.com images on purpose — profileCompleteness.hasRealPhoto()
// classifies any unsplash URL as "no real photo yet", so swapping the dog for a
// cat here never makes a profile look more complete than it is.

import { hasRealPhoto } from './profileCompleteness';

const DOG_FALLBACK = 'https://images.unsplash.com/photo-1583337130417-3346a1be7dee';
const CAT_FALLBACK = 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba';

/** A stock photo matching the pet's species (defaults to dog for unknown). */
export function petFallbackImage(species?: string | null, width = 1000): string {
  const base = species === 'cat' ? CAT_FALLBACK : DOG_FALLBACK;
  return `${base}?q=80&w=${width}&auto=format&fit=crop`;
}

/**
 * The image to actually show for a pet: the user's real photo when there is
 * one, otherwise a species-correct placeholder. Treats the legacy stored
 * unsplash placeholders as "no real photo" so cats stop rendering the old dog.
 */
export function resolvePetImage(
  imageUrl: string | null | undefined,
  species?: string | null,
  width = 1000,
): string {
  return hasRealPhoto(imageUrl) ? (imageUrl as string) : petFallbackImage(species, width);
}
