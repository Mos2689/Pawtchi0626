// Deterministic "worth knowing" insights for the reveal screen.
//
// Each returned line is short, sentence case, brand-voice compliant, and
// genuinely informative — the kind of thing a calm vet nurse would mention in
// passing. Tailored to species × size × life stage × body condition × weight
// goal, with a stable priority order so the same pet always gets the same
// insight set. Pure → unit-testable.

import type { SizeCategory } from './breedData';
import { getBreedDefaults } from './breedData';
import type { LifeStage } from './lifeStage';

// Brachycephalic ("flat-faced") breeds where mild excess weight is acutely
// risky — BOAS exacerbation, anaesthesia mortality, heatstroke. Keep this
// regex in sync with BREED_HINTS line ~47.
const BRACHYCEPHALIC_PATTERN = /bulldog|pug|boxer|shih.?tzu|boston terrier|cavalier|pekingese|persian|himalayan|exotic|british shorthair|brachycephalic/i;

export type WatchOutIcon =
  | 'restaurant'        // food, portion, treats
  | 'directions-walk'   // joints, movement
  | 'water-drop'        // hydration
  | 'pets'              // grooming, dental, coat
  | 'monitor-heart';    // breathing, heart, heat

export interface WatchOut {
  icon: WatchOutIcon;
  text: string;
}

export interface WatchOutInput {
  species: 'dog' | 'cat';
  breed: string | null;
  sizeCategory: SizeCategory | null;
  lifeStage: LifeStage;
  /** Body condition score, 1–9. */
  bcs: number | null;
  /** Current weight in kg minus target weight in kg (positive = above goal). */
  weightVsTargetKg: number | null;
  /**
   * Absolute current weight in kg. Optional — used to flag brachycephalic
   * breeds carrying >15% over their breed reference even when BCS reads 5/9,
   * because owners of these breeds reliably under-score body condition.
   */
  currentWeightKg?: number | null;
}

// ─── The catalog — every entry is calm, specific, ≤ 3 sentences ───
// Order matters: earlier matches win priority slots. We always return 2–3.

const BREED_HINTS: { match: (b: string) => boolean; entries: WatchOut[] }[] = [
  {
    match: (b) => /labrador|golden retriever|beagle|cocker spaniel/i.test(b),
    entries: [
      { icon: 'restaurant', text: 'this breed loves food more than the body needs it; measure each meal rather than free-pouring.' },
      { icon: 'pets', text: 'ears trap moisture after baths and swims, so a quick dry helps prevent infections.' },
    ],
  },
  {
    match: (b) => /bulldog|pug|boxer|shih.?tzu|boston terrier|cavalier|persian|himalayan|exotic|british shorthair/i.test(b),
    entries: [
      { icon: 'monitor-heart', text: 'a shorter muzzle makes breathing harder when warm; avoid midday walks in summer and keep water close.' },
      { icon: 'pets', text: 'skin folds need a wipe and dry every couple of days to stay calm.' },
    ],
  },
  {
    match: (b) => /german shepherd|rottweiler|great dane|saint bernard|mastiff|husky/i.test(b),
    entries: [
      { icon: 'directions-walk', text: 'large breeds carry more pressure on hips and elbows; steady daily movement protects joints more than weekend bursts.' },
    ],
  },
  {
    match: (b) => /poodle|maltese|yorkshire|bichon|schnauzer/i.test(b),
    entries: [
      { icon: 'pets', text: 'this coat does not shed much, so a brush every few days keeps mats and tangles away.' },
    ],
  },
  {
    match: (b) => /maine coon|ragdoll|norwegian forest/i.test(b),
    entries: [
      { icon: 'pets', text: 'long coats need a brush a few times a week to stop hairballs and mats.' },
    ],
  },
];

function fromBreed(breed: string | null): WatchOut[] {
  if (!breed || !breed.trim()) return [];
  const hit = BREED_HINTS.find((h) => h.match(breed));
  return hit ? hit.entries.slice() : [];
}

function fromSizeAndLifeStage(species: 'dog' | 'cat', size: SizeCategory | null, stage: LifeStage): WatchOut[] {
  const out: WatchOut[] = [];
  if (species === 'dog') {
    if (size === 'large' || size === 'giant') {
      out.push({
        icon: 'directions-walk',
        text: 'large frames feel weight extra; keeping the daily plate tight is one of the best things you can do for joints.',
      });
    }
    if (size === 'toy' || size === 'small') {
      out.push({
        icon: 'pets',
        text: 'small dogs build tartar quickly, so a daily brush or dental chew goes a long way.',
      });
    }
    if (stage === 'puppy' || stage === 'junior') {
      out.push({
        icon: 'restaurant',
        text: 'growing bones need steady, smaller meals across the day rather than two big ones.',
      });
    }
    if (stage === 'senior' || stage === 'geriatric' || stage === 'mature') {
      out.push({
        icon: 'directions-walk',
        text: 'shorter, more frequent walks are gentler on older joints than one long outing.',
      });
    }
  } else {
    // cats
    out.push({
      icon: 'water-drop',
      text: 'cats are quiet drinkers; a wide bowl or a small fountain in a calm spot encourages more sips.',
    });
    if (stage === 'kitten' || stage === 'junior') {
      out.push({
        icon: 'restaurant',
        text: 'kittens do best on a few small meals a day while they grow.',
      });
    } else {
      out.push({
        icon: 'pets',
        text: 'adult cats build tartar without noticing; a soft toothbrush or a vet-approved chew helps.',
      });
    }
    if (stage === 'senior' || stage === 'geriatric' || stage === 'mature') {
      out.push({
        icon: 'monitor-heart',
        text: 'older cats often hide stiffness; a low-step litter tray and a warm sleep spot make daily life easier.',
      });
    }
  }
  return out;
}

/**
 * Brachycephalic + over-breed-reference nudge.
 *
 * Frenchies / Pugs / Bulldogs in clinical practice are reliably under-scored
 * by owners (they always look "muscular"). Combined with the BCS-5-maintain
 * rule in deriveGoal, an actually-overweight brachycephalic dog can sit on a
 * maintenance plan indefinitely. For these breeds, even mild excess weight is
 * acutely dangerous — BOAS exacerbation, heatstroke, anaesthesia risk.
 *
 * Doesn't override the kcal target; surfaces a watch-out asking the owner to
 * check in with a vet.
 */
function fromBrachycephalicOverweight(
  breed: string | null,
  species: 'dog' | 'cat',
  currentWeightKg: number | null | undefined,
): WatchOut[] {
  if (!breed || species !== 'dog') return [];
  if (typeof currentWeightKg !== 'number' || currentWeightKg <= 0) return [];
  if (!BRACHYCEPHALIC_PATTERN.test(breed)) return [];

  const defaults = getBreedDefaults('dog', breed, currentWeightKg);
  if (!defaults) return [];
  // Use the wider of the male/female upper bounds as the "is this above breed
  // reference?" threshold. We don't know the dog's sex here and we'd rather
  // false-negative than false-positive the warning.
  const upper = Math.max(defaults.weightRange.male[1], defaults.weightRange.female[1]);
  if (currentWeightKg <= upper * 1.15) return [];

  return [{
    icon: 'monitor-heart',
    text: 'flat-faced breeds often look muscular even when carrying extra weight; even mild excess makes breathing harder, so a vet weigh-in is worth booking.',
  }];
}

function fromBodyAndWeight(bcs: number | null, weightVsTargetKg: number | null): WatchOut[] {
  const out: WatchOut[] = [];
  if (typeof bcs === 'number' && bcs >= 7) {
    out.push({
      icon: 'restaurant',
      text: 'the score sits above the ideal range; staying on the daily plate beats any quick fix.',
    });
  }
  if (typeof weightVsTargetKg === 'number' && weightVsTargetKg >= 0.5) {
    out.push({
      icon: 'directions-walk',
      text: 'small, steady losses of around one percent of body weight a week are safer than crash changes.',
    });
  }
  if (typeof weightVsTargetKg === 'number' && weightVsTargetKg <= -0.5) {
    out.push({
      icon: 'restaurant',
      text: 'a touch under target is fine while energy stays good; keep the plate consistent rather than topping up.',
    });
  }
  return out;
}

function dedupe(items: WatchOut[]): WatchOut[] {
  const seen = new Set<string>();
  const result: WatchOut[] = [];
  for (const i of items) {
    if (seen.has(i.text)) continue;
    seen.add(i.text);
    result.push(i);
  }
  return result;
}

export function getBreedWatchOuts(input: WatchOutInput): WatchOut[] {
  // Priority: brachycephalic safety nudge first (potentially acute), then body
  // condition signals (actionable today), then breed-specific traits, then
  // size + life-stage backstops.
  const ordered = [
    ...fromBrachycephalicOverweight(input.breed, input.species, input.currentWeightKg),
    ...fromBodyAndWeight(input.bcs, input.weightVsTargetKg),
    ...fromBreed(input.breed),
    ...fromSizeAndLifeStage(input.species, input.sizeCategory, input.lifeStage),
  ];
  return dedupe(ordered).slice(0, 3);
}
