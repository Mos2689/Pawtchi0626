/**
 * Client-side allergen detection for the Quick Log flow.
 *
 * The regular scan flow has Gemini cross-reference image-extracted ingredients
 * against the pet's allergies and return `is_allergy_trigger` + warnings. Quick
 * Log skips Gemini, so we re-derive the same flags from pantry data + pet
 * profile here. Same logic is applied so both flows produce consistent
 * verdicts for the same pantry item + same pet.
 *
 * Matching is intentionally lenient: substring + lowercase. Real-world
 * ingredients say "chicken meal", "chicken broth", "chicken fat" — all of
 * which should trip a "chicken" allergy. False positives are preferable to
 * false negatives in a health-safety context.
 */

export interface AllergenMatch {
  isMatch: boolean;
  /** Allergens that matched, lowercased. Empty if no match. */
  matchedAllergens: string[];
  /**
   * Human-readable warnings, one per matched allergen, formatted like the
   * Gemini path: "Contains <Allergen>, which is on <Pet>'s allergen list".
   * Pass `petName` to include it; otherwise the warning just names the allergen.
   */
  warnings: string[];
}

/**
 * Detect allergen matches between a food's ingredients/name and a pet's
 * allergy list. Case-insensitive, substring-based.
 *
 * @param sources — strings to scan: typically `[food_name, ...key_ingredients]`
 * @param allergies — pet's known allergens (e.g. `['Chicken', 'Beef']`)
 * @param petName — optional, used to format human-readable warnings
 */
export function detectAllergens(
  sources: (string | null | undefined)[],
  allergies: (string | null | undefined)[] | null | undefined,
  petName?: string,
): AllergenMatch {
  const cleanedAllergies = (allergies ?? [])
    .filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
    .map((a) => a.trim().toLowerCase());

  if (cleanedAllergies.length === 0) {
    return { isMatch: false, matchedAllergens: [], warnings: [] };
  }

  const haystack = sources
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map((s) => s.toLowerCase())
    .join(' | ');

  if (haystack.length === 0) {
    return { isMatch: false, matchedAllergens: [], warnings: [] };
  }

  const matched = new Set<string>();
  for (const allergen of cleanedAllergies) {
    // Word-boundary-ish check: the allergen should appear as a whole word or
    // word prefix in the ingredient text. "egg" should match "eggs" but not
    // "veggie". A simple substring is too lenient.
    const re = new RegExp(`\\b${escapeRegex(allergen)}`, 'i');
    if (re.test(haystack)) {
      matched.add(allergen);
    }
  }

  const matchedAllergens = Array.from(matched);
  const warnings = matchedAllergens.map((a) => {
    const display = capitalize(a);
    return petName
      ? `Contains ${display}, which is on ${petName}'s allergen list`
      : `Contains ${display}`;
  });

  return {
    isMatch: matchedAllergens.length > 0,
    matchedAllergens,
    warnings,
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
