/**
 * Hard-coded acute-toxin blocklist for dogs and cats.
 *
 * This complements the LLM-tagged `ingredients_of_concern` list with a static
 * safety net. The LLM is good at structured nutrition reasoning but can miss
 * ingredient toxicity if a label omits the toxic term or uses a synonym
 * (e.g. "birch sugar" instead of "xylitol"). For acute toxins where minutes
 * matter (xylitol → hypoglycemia within 30 min, grapes → AKI), we deterministically
 * check for known names and synonyms regardless of what the LLM tagged.
 *
 * False positives are preferable to false negatives. We err on the side of
 * flagging — an owner can verify the label, but a missed xylitol detection
 * is potentially lethal.
 *
 * Sources: ASPCA Animal Poison Control Center, AVMA, Merck Vet Manual.
 */

export type ToxinHit = {
  /** The canonical toxin name (e.g. "Xylitol"). */
  toxin: string;
  /** The substring/term that actually matched in the food text. */
  matchedTerm: string;
  /** Plain-language reason for the owner. */
  reason: string;
};

type ToxinEntry = {
  canonical: string;
  /** Regex patterns (word-boundary-ish). All matched against lowercased haystack. */
  patterns: RegExp[];
  reason: string;
};

// ── Shared (toxic for both species) ──
const SHARED_TOXINS: ToxinEntry[] = [
  {
    canonical: 'Xylitol',
    patterns: [
      /\bxylitol\b/i,
      /\bbirch\s*sugar\b/i,
      /\be\s*-?\s*967\b/i,
    ],
    reason: 'Causes a rapid drop in blood sugar and liver failure. Severe risk within 30 minutes.',
  },
  {
    canonical: 'Chocolate',
    patterns: [
      /\bchocolate\b/i,
      /\bcocoa(?!\s*butter)\b/i, // exclude "cocoa butter" which is generally non-toxic at typical amounts
      /\bcacao\b/i,
      /\btheobromine\b/i,
    ],
    reason: 'Theobromine is toxic — can cause vomiting, seizures, and cardiac arrhythmia.',
  },
  {
    canonical: 'Grapes / Raisins',
    patterns: [
      /\bgrapes?\b/i,
      /\braisins?\b/i,
      /\bsultanas?\b/i,
      /\bcurrants?\b/i,
    ],
    reason: 'Even small amounts can cause acute kidney injury. Mechanism unclear, individual sensitivity varies.',
  },
  {
    canonical: 'Onion / Garlic / Allium',
    patterns: [
      /\bonions?\b/i,
      /\bgarlic\b/i,
      /\bleeks?\b/i,
      /\bchives?\b/i,
      /\bshallots?\b/i,
      /\ballium\b/i,
    ],
    reason: 'Damages red blood cells, leading to hemolytic anemia. Cats are especially sensitive.',
  },
  {
    canonical: 'Macadamia nuts',
    patterns: [
      /\bmacadamia\b/i,
    ],
    reason: 'Causes weakness, tremors, and hyperthermia in dogs. Toxicity in cats is less documented but advised against.',
  },
  {
    canonical: 'Alcohol / Ethanol',
    patterns: [
      /\bethanol\b/i,
      /\balcohol\b/i,
      /\bbeer\b/i,
      /\bliquor\b/i,
      /\bwine\b/i,
    ],
    reason: 'Even small amounts can cause respiratory depression, hypoglycemia, and acidosis.',
  },
  {
    canonical: 'Bread dough (raw yeast)',
    patterns: [
      /\braw\s+(?:bread\s+)?dough\b/i,
      /\bunbaked\s+dough\b/i,
    ],
    reason: 'Yeast fermentation produces ethanol and gas — risk of bloat and alcohol toxicity.',
  },
];

// ── Dog-specific ──
const DOG_TOXINS: ToxinEntry[] = [
  ...SHARED_TOXINS,
];

// ── Cat-specific (everything above + cat-only) ──
const CAT_TOXINS: ToxinEntry[] = [
  ...SHARED_TOXINS,
  {
    canonical: 'Lily',
    patterns: [
      /\blilies\b/i,
      /\blily\b/i,
    ],
    reason: 'Lilies cause acute kidney failure in cats — exposure to any part of the plant can be fatal.',
  },
  {
    canonical: 'Raw fish (thiaminase)',
    patterns: [
      /\braw\s+fish\b/i,
      /\braw\s+tuna\b/i,
      /\braw\s+salmon\b/i,
    ],
    reason: 'Contains thiaminase which destroys vitamin B1 — chronic exposure causes neurological disease in cats.',
  },
];

/**
 * Scan a food's name and ingredient text for acute toxins.
 *
 * @param species - 'dog' or 'cat'
 * @param sources - strings to scan (food name, ingredients, etc.)
 * @returns array of toxin hits (empty if clean)
 */
export function findToxicIngredients(
  species: 'dog' | 'cat',
  sources: (string | null | undefined)[],
): ToxinHit[] {
  const list = species === 'cat' ? CAT_TOXINS : DOG_TOXINS;
  const haystack = sources
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .join(' | ')
    .toLowerCase();

  if (haystack.length === 0) return [];

  const hits: ToxinHit[] = [];
  for (const entry of list) {
    for (const re of entry.patterns) {
      const match = haystack.match(re);
      if (match) {
        hits.push({
          toxin: entry.canonical,
          matchedTerm: match[0],
          reason: entry.reason,
        });
        break; // one hit per toxin is enough
      }
    }
  }
  return hits;
}

/** Convenience: just check whether anything's toxic. */
export function hasToxicIngredients(
  species: 'dog' | 'cat',
  sources: (string | null | undefined)[],
): boolean {
  return findToxicIngredients(species, sources).length > 0;
}
