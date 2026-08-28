/**
 * Breed lists — one source, now that breed is asked on two screens.
 *
 * Walk-first onboarding asks dogs for their breed at step two, and the health
 * completion flow asks again on body-basics. Two copies of these arrays would
 * mean a breed added to one picker quietly missing from the other.
 *
 * Ordered by prevalence in the AU/UK market rather than alphabetically, so the
 * common answers are reachable without typing. 'Mixed Breed' leads because it
 * is the single most common answer; 'Other' closes because the picker also
 * accepts free text for anything not listed.
 */

export const DOG_BREEDS = [
  'Mixed Breed',
  'Labrador Retriever', 'Staffordshire Bull Terrier', 'French Bulldog', 'German Shepherd',
  'Golden Retriever', 'Border Collie', 'Cavalier King Charles Spaniel', 'Australian Kelpie',
  'Bulldog', 'Beagle', 'Rottweiler', 'Yorkshire Terrier', 'Boxer', 'Husky', 'Corgi',
  'Pug', 'Australian Shepherd', 'Australian Cattle Dog', 'Shih Tzu', 'Pomeranian',
  'Maltese', 'Jack Russell Terrier', 'Miniature Schnauzer', 'Cocker Spaniel',
  'West Highland White Terrier',
  'Toy Poodle', 'Miniature Poodle', 'Standard Poodle',
  'Miniature Dachshund', 'Standard Dachshund',
  'Cavoodle', 'Labradoodle', 'Groodle', 'Spoodle', 'Moodle', 'Puggle',
  'Other',
];

export const CAT_BREEDS = [
  'Mixed Breed / Domestic Shorthair', 'Domestic Longhair', 'Ragdoll', 'Maine Coon', 'Persian',
  'British Shorthair', 'Sphynx', 'Bengal', 'Abyssinian', 'Scottish Fold', 'Siamese',
  'Russian Blue', 'Burmese', 'Birman', 'Other',
];

export function breedsFor(species: 'dog' | 'cat' | null | undefined): string[] {
  return species === 'cat' ? CAT_BREEDS : DOG_BREEDS;
}
