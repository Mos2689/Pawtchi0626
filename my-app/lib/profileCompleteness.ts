// Profile completeness — how much of the accuracy-critical pet profile is filled in.
//
// Onboarding lets users skip steps (and never asks for some fields at all), which
// silently degrades calorie targets, scan accuracy, and personalisation. This scores
// the gaps by impact and returns an ordered, deep-linkable to-do list so the app can
// nudge — quietly, never blocking — toward an accurate profile.
//
// Pure and dependency-free so it's unit-testable (matches the lib/*.test.ts pattern).

export type FocusKey =
  | 'photo'
  | 'breed'
  | 'age'
  | 'bcs'
  | 'gender'
  | 'allergies'
  | 'bowl_size'
  | 'pantry';

export interface MissingItem {
  key: FocusKey;
  label: string; // calm, brand-voice, pet-name agnostic (caller may prefix the name)
  impact: 'high' | 'med';
  focus: FocusKey; // deep-link target the Profile screen understands
}

export interface CompletenessPet {
  image_url?: string | null;
  breed?: string | null;
  age_years?: number | null;
  body_condition_score?: number | null;
  gender?: string | null;
  allergies?: string[] | null;
  bowl_size?: string | null;
}

export interface CompletenessResult {
  score: number; // 0–100, weighted by impact
  missing: MissingItem[]; // high-impact first
  isAccurateEnough: boolean; // every high-impact field present
}

// A real, user-provided photo. Onboarding falls back to a stock Unsplash image, so
// any unsplash URL (or no URL) counts as "no real photo yet".
export function hasRealPhoto(imageUrl?: string | null): boolean {
  const url = (imageUrl ?? '').trim();
  if (!url) return false;
  return !url.toLowerCase().includes('unsplash.com');
}

interface FieldSpec {
  key: FocusKey;
  label: string;
  impact: 'high' | 'med';
  weight: number;
  present: (pet: CompletenessPet, ctx: { pantryCount: number }) => boolean;
}

const FIELDS: FieldSpec[] = [
  { key: 'photo', label: 'Add a photo', impact: 'high', weight: 2, present: (p) => hasRealPhoto(p.image_url) },
  { key: 'breed', label: 'Add the breed', impact: 'high', weight: 2, present: (p) => !!(p.breed && p.breed.trim()) },
  { key: 'age', label: 'Add the age', impact: 'high', weight: 2, present: (p) => typeof p.age_years === 'number' && p.age_years > 0 },
  { key: 'bcs', label: 'Set the body shape', impact: 'high', weight: 2, present: (p) => typeof p.body_condition_score === 'number' && p.body_condition_score > 0 },
  { key: 'gender', label: 'Add the sex', impact: 'med', weight: 1, present: (p) => p.gender === 'male' || p.gender === 'female' },
  { key: 'allergies', label: 'Confirm any food sensitivities', impact: 'med', weight: 1, present: (p) => Array.isArray(p.allergies) },
  { key: 'bowl_size', label: 'Set the bowl size', impact: 'med', weight: 1, present: (p) => !!(p.bowl_size && p.bowl_size.trim()) },
  { key: 'pantry', label: 'Add a food to the pantry', impact: 'med', weight: 1, present: (_p, ctx) => ctx.pantryCount > 0 },
];

export function computeCompleteness(
  pet: CompletenessPet | null | undefined,
  ctx: { pantryCount?: number } = {},
): CompletenessResult {
  const context = { pantryCount: ctx.pantryCount ?? 0 };
  if (!pet) {
    return {
      score: 0,
      missing: FIELDS.map(({ key, label, impact }) => ({ key, label, impact, focus: key })),
      isAccurateEnough: false,
    };
  }

  const totalWeight = FIELDS.reduce((s, f) => s + f.weight, 0);
  let presentWeight = 0;
  const missing: MissingItem[] = [];

  for (const f of FIELDS) {
    if (f.present(pet, context)) {
      presentWeight += f.weight;
    } else {
      missing.push({ key: f.key, label: f.label, impact: f.impact, focus: f.key });
    }
  }

  // High-impact first, preserving declaration order within each tier.
  missing.sort((a, b) => (a.impact === b.impact ? 0 : a.impact === 'high' ? -1 : 1));

  const score = Math.round((presentWeight / totalWeight) * 100);
  const isAccurateEnough = !missing.some((m) => m.impact === 'high');

  return { score, missing, isAccurateEnough };
}
