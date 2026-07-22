/**
 * activityRestrictions — single source of truth for translating freeform
 * medical_conditions strings into exercise restrictions.
 *
 * Two consumers with different needs:
 *   - usePetContextStore / nudgeEngine want human-readable labels
 *     ("no high-impact activities") to soften nudge copy.
 *   - generate-schedule wants a machine-enforceable intensity ceiling so a
 *     restricted pet can never be scheduled a session above its cap,
 *     regardless of what the LLM archetype pool contains.
 *
 * Keep the condition keywords in sync with the restriction map that
 * previously lived inline in usePetContextStore.deriveClinical.
 */

export type ActivityIntensity = 'low' | 'moderate' | 'high';

export interface ActivityRestriction {
  /** Human-readable restriction, shown in nudges and passed to the LLM. */
  label: string;
  /** Hardest intensity this condition safely allows. Enforced in code. */
  maxIntensity: ActivityIntensity;
}

interface RestrictionRule extends ActivityRestriction {
  /** Case-insensitive substring matched against the freeform condition. */
  keyword: string;
}

// Intensity ceilings are deliberately conservative but not paralyzing:
// cardiac and spinal conditions cap at 'low'; orthopedic wear conditions
// allow 'moderate' (controlled leash walks) but never 'high'.
const RESTRICTION_RULES: RestrictionRule[] = [
  { keyword: 'arthritis',     label: 'no high-impact activities',        maxIntensity: 'moderate' },
  { keyword: 'hip dysplasia', label: 'no jumping or stairs',             maxIntensity: 'moderate' },
  { keyword: 'heart disease', label: 'limit vigorous exercise',          maxIntensity: 'low' },
  { keyword: 'obesity',       label: 'gradual activity increase only',   maxIntensity: 'moderate' },
  { keyword: 'ivdd',          label: 'no jumping, limit stairs',         maxIntensity: 'low' },
];

const INTENSITY_ORDER: Record<ActivityIntensity, number> = { low: 0, moderate: 1, high: 2 };

/**
 * Structured restrictions for a pet's medical_conditions list.
 * Deduplicated by label; order follows RESTRICTION_RULES.
 */
export function deriveActivityRestrictions(
  conditions: string[] | null | undefined,
): ActivityRestriction[] {
  if (!conditions || conditions.length === 0) return [];
  const out: ActivityRestriction[] = [];
  for (const rule of RESTRICTION_RULES) {
    const hit = conditions.some(c => c.toLowerCase().includes(rule.keyword));
    if (hit) out.push({ label: rule.label, maxIntensity: rule.maxIntensity });
  }
  return out;
}

/** Label-only view, matching the legacy usePetContextStore shape. */
export function deriveActivityRestrictionLabels(
  conditions: string[] | null | undefined,
): string[] {
  return deriveActivityRestrictions(conditions).map(r => r.label);
}

/**
 * The tightest intensity ceiling across all restrictions, or null when the
 * pet is unrestricted.
 */
export function maxAllowedIntensity(
  restrictions: ActivityRestriction[],
): ActivityIntensity | null {
  if (restrictions.length === 0) return null;
  return restrictions.reduce<ActivityIntensity>(
    (min, r) => (INTENSITY_ORDER[r.maxIntensity] < INTENSITY_ORDER[min] ? r.maxIntensity : min),
    'high',
  );
}
