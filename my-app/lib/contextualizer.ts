/**
 * Contextualizer — translates raw health numbers into relatable real-world equivalents.
 *
 * Vet-sound reference values:
 * - Standard kibble: ~350 kcal/cup (AAFCO average for adult maintenance kibble)
 * - Water bowl sizes: small dog 200ml, medium 300ml, large 400ml
 * - Walking pace: small 3km/h, medium 4km/h, large 5km/h (average leash-walk)
 */

type PetSize = 'small' | 'medium' | 'large';

function getPetSize(weightKg: number): PetSize {
  if (weightKg < 10) return 'small';
  if (weightKg < 25) return 'medium';
  return 'large';
}

/**
 * Converts calories into a kibble-cup equivalent.
 * Uses ~350 kcal/cup (AAFCO standard adult maintenance kibble).
 */
export function contextualizeCalories(kcal: number, _species = 'dog'): string | null {
  if (kcal <= 0) return null;

  const KCAL_PER_CUP = 350;
  const cups = kcal / KCAL_PER_CUP;

  if (cups < 0.3) return `≈ a few tablespoons of kibble`;
  if (cups < 1) return `≈ ${(cups).toFixed(1)} cup of kibble`;
  return `≈ ${cups.toFixed(1)} cups of kibble`;
}

/**
 * Converts water in ml into bowl-refill equivalents, sized for the pet.
 */
export function contextualizeWater(ml: number, weightKg: number): string | null {
  if (ml <= 0) return null;

  const size = getPetSize(weightKg);
  const bowlSize = size === 'small' ? 200 : size === 'medium' ? 300 : 400;
  const bowls = ml / bowlSize;

  if (bowls < 1) return `≈ ${Math.round(bowls * 100)}% of a bowl`;
  const rounded = Math.round(bowls * 2) / 2; // round to nearest 0.5
  return `≈ ${rounded} bowl${rounded !== 1 ? 's' : ''}`;
}

/**
 * Estimates walk distance from duration based on pet size (leash-walk pace).
 * Small: 3 km/h, Medium: 4 km/h, Large: 5 km/h
 */
export function contextualizeWalk(
  durationMin: number,
  weightKg: number,
  _species = 'dog',
): string | null {
  if (durationMin <= 0) return null;

  const size = getPetSize(weightKg);
  const paceKmH = size === 'small' ? 3 : size === 'medium' ? 4 : 5;
  const distanceKm = (durationMin / 60) * paceKmH;

  if (distanceKm < 0.5) return `≈ ${Math.round(distanceKm * 1000)}m at a ${size}-dog pace`;
  return `≈ ${distanceKm.toFixed(1)} km at a ${size}-dog pace`;
}
