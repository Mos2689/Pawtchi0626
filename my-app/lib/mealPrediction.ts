import type { PantryItem } from '../store/useActivePetStore';

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'late';

export interface MealPrediction {
  hero: PantryItem | null;
  alternatives: PantryItem[];
  slot: MealSlot;
  eyebrow: string;
}

const HOUR_TO_SLOT: Record<number, MealSlot> = {} as Record<number, MealSlot>;
for (let h = 5; h < 10; h++) HOUR_TO_SLOT[h] = 'breakfast';
for (let h = 10; h < 15; h++) HOUR_TO_SLOT[h] = 'lunch';
for (let h = 15; h < 22; h++) HOUR_TO_SLOT[h] = 'dinner';
for (let h = 22; h < 24; h++) HOUR_TO_SLOT[h] = 'late';
for (let h = 0; h < 5; h++) HOUR_TO_SLOT[h] = 'late';

export function currentSlot(date: Date = new Date()): MealSlot {
  return HOUR_TO_SLOT[date.getHours()] ?? 'dinner';
}

/**
 * Eyebrow copy that personalises the hero without sounding scripted.
 * Pet's name is woven in for warmth; phrasing stays conversational.
 */
export function eyebrowFor(slot: MealSlot, petName: string | null | undefined): string {
  const name = petName?.trim() || 'your pet';
  switch (slot) {
    case 'breakfast': return `Breakfast for ${name}`;
    case 'lunch':     return `Lunchtime for ${name}`;
    case 'dinner':    return `Dinner for ${name}`;
    case 'late':      return `Late snack for ${name}`;
  }
}

/**
 * Score a pantry item for the current moment. Higher = better hero candidate.
 * Signals (weighted):
 *   - favorite (sticky boost)              : +10
 *   - is_primary (the owner's go-to food)  : +6
 *   - scan_count (frequency)               : +scan_count, capped at 20
 *   - recency (last_scanned_at within 7d)  : +5 / +3 / +1 by tier
 *   - expiring soon (use before it spoils) : +2
 *   - food_type matches the meal slot      : +4
 * The food-type heuristic uses common-sense pairings: breakfast/lunch/dinner
 * tend to be the staple kibble or wet food; "late" leans treat-friendly.
 */
function scoreItem(item: PantryItem, slot: MealSlot, now: number): number {
  let score = 0;

  if (item.is_favorite) score += 10;
  if (item.is_primary) score += 6;

  const sc = item.scan_count || 0;
  score += Math.min(sc, 20);

  if (item.last_scanned_at) {
    const ageDays = (now - new Date(item.last_scanned_at).getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays <= 1) score += 5;
    else if (ageDays <= 3) score += 3;
    else if (ageDays <= 7) score += 1;
  }

  if (item.expiry_date) {
    const daysToExpiry = Math.ceil((new Date(item.expiry_date).getTime() - now) / (1000 * 60 * 60 * 24));
    if (daysToExpiry >= 0 && daysToExpiry <= 7) score += 2;
  }

  // Slot-aware nudge: treats trail meals during the day, lead at "late".
  const isTreat = item.food_type === 'treat' || item.food_type === 'supplement';
  const isMealFood = item.food_type === 'kibble' || item.food_type === 'wet_food' || item.food_type === 'raw';
  if (slot === 'late' && isTreat) score += 4;
  else if (slot !== 'late' && isMealFood) score += 4;

  return score;
}

/**
 * Pick the hero + 3 alternatives for the current moment.
 * Pure function: takes pantry + clock, returns a prediction. No I/O.
 */
export function predictMeal(
  pantry: PantryItem[],
  petName: string | null | undefined,
  now: Date = new Date(),
): MealPrediction {
  const slot = currentSlot(now);
  const eyebrow = eyebrowFor(slot, petName);

  if (pantry.length === 0) {
    return { hero: null, alternatives: [], slot, eyebrow };
  }

  const ts = now.getTime();
  const ranked = [...pantry]
    .map(item => ({ item, score: scoreItem(item, slot, ts) }))
    .sort((a, b) => b.score - a.score)
    .map(r => r.item);

  return {
    hero: ranked[0] ?? null,
    alternatives: ranked.slice(1, 4),
    slot,
    eyebrow,
  };
}
