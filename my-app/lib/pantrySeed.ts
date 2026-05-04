/**
 * Pantry seed lookup — pre-populates a user's pantry when they scan a known
 * Australian food product, skipping the Gemini round-trip.
 *
 * Strategy: hand-curated JSON data (data/au_seed_foods.json), fuzzy-matched
 * by brand + product_name. When the user adds a known product to their
 * pantry (or scans one), the seed entry's nutrition data fills in
 * automatically. The user can override at any time — pantry is the source
 * of truth, not the seed table.
 *
 * This is the lightest-weight implementation: no DB migration, no global
 * pantry-foods table, no scheduled refresh. To grow coverage, add entries
 * to au_seed_foods.json.
 */

import seedData from '../data/au_seed_foods.json';

export type SeedFood = {
  brand: string;
  product_name: string;
  species: 'dog' | 'cat';
  food_type: 'kibble' | 'wet_food' | 'raw' | 'freeze_dried' | 'home_cooked' | 'treat';
  life_stage: 'puppy' | 'kitten' | 'adult' | 'senior' | 'all_life_stages';
  kcal_per_100g: number;
  moisture_pct: number;
  protein_pct: number;
  fat_pct: number;
  fibre_pct: number;
  calcium_pct: number | null;
  phosphorus_pct: number | null;
  key_ingredients: string[];
};

const SEED_FOODS = (seedData.foods as SeedFood[]) || [];

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Fuzzy match a brand + product name against the seed catalogue.
 *
 * Match strategy:
 *   1. Exact (brand, product_name) after normalization → highest score.
 *   2. Brand exact, product_name substring/contains → medium score.
 *   3. Otherwise null.
 *
 * Returns the best seed entry and a confidence score 0–1, or null if no
 * acceptable match.
 */
export function lookupSeedFood(
  brand: string | null | undefined,
  productName: string | null | undefined,
  species?: 'dog' | 'cat',
): { food: SeedFood; confidence: number } | null {
  if (!brand || !productName) return null;
  const nb = normalize(brand);
  const np = normalize(productName);
  if (!nb || !np) return null;

  let best: { food: SeedFood; confidence: number } | null = null;

  for (const food of SEED_FOODS) {
    if (species && food.species !== species) continue;

    const fb = normalize(food.brand);
    const fp = normalize(food.product_name);

    if (fb !== nb) continue; // require brand match

    let confidence = 0;
    if (fp === np) confidence = 1.0;
    else if (np.includes(fp) || fp.includes(np)) confidence = 0.85;
    else {
      // Token overlap
      const npTokens = new Set(np.split(' '));
      const fpTokens = fp.split(' ');
      const overlap = fpTokens.filter(t => npTokens.has(t)).length;
      if (overlap >= Math.max(2, Math.floor(fpTokens.length * 0.5))) {
        confidence = 0.7;
      }
    }

    if (confidence > 0 && (!best || confidence > best.confidence)) {
      best = { food, confidence };
    }
  }

  return best && best.confidence >= 0.7 ? best : null;
}

/** Convenience: list every seed food (used by an "Add from catalogue" UI). */
export function listSeedFoods(species?: 'dog' | 'cat'): SeedFood[] {
  return species ? SEED_FOODS.filter(f => f.species === species) : SEED_FOODS;
}
