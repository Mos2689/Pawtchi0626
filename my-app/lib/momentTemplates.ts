/**
 * Moment templates — the earned library of daily-walk share cards.
 *
 * One walk, many skins: every template renders the SAME walk content (route,
 * headline, stats, place, date, wordmark); walking consistently unlocks more
 * premium designs. The milestone is only the access key — it is never the
 * card's subject, and no template may carry a walk count, streak number, or
 * "X walks" language anywhere on its face. The exclusivity is the design.
 *
 * Separate from the milestone celebration ladder in pawPrints.ts on purpose:
 * gates here persist as `template_*` ids in pet_milestones (same idempotent
 * table, disjoint id space), so the navy celebration cards never fire for a
 * template unlock and vice versa. Once earned, a template never regresses —
 * the library is the union of what the walk count derives and what the DB
 * remembers.
 *
 * Pure — supabase reads/writes stay in pawPrintsSync.ts. All user-facing
 * strings comply with the Pawtchi Copy Spec v1 (no exclamation marks, never
 * "your pet", calm sentence case) and are enforced by momentTemplates.test.ts.
 * Template display names pend the usual trademark screen before store copy
 * hardens (same caveat as lib/walksign/copy.ts).
 */

export type MomentTemplateId =
  | 'fieldbook'
  | 'gallery'
  | 'postcard'
  | 'editorial'
  | 'cartographer'
  | 'signature';

export type MomentColorwayId = 'classic' | 'dusk';

export interface MomentTemplateDef {
  id: MomentTemplateId;
  /** Display name in the picker ("the Gallery card"). */
  name: string;
  /** Cumulative valid-walk count that opens the gate; null = day one. */
  unlockAtWalks: number | null;
  /** Card aspect — 9:16 story or 4:5 portrait. */
  aspect: '9:16' | '4:5';
  /** Colorways beyond classic this template can wear (premium-gated). */
  colorways: MomentColorwayId[];
}

/** Shelf order = unlock order. Append new tiers; never remove or reorder. */
export const MOMENT_TEMPLATES: MomentTemplateDef[] = [
  { id: 'fieldbook', name: 'Fieldbook', unlockAtWalks: null, aspect: '9:16', colorways: [] },
  { id: 'gallery', name: 'Gallery', unlockAtWalks: 7, aspect: '4:5', colorways: ['dusk'] },
  { id: 'postcard', name: 'Postcard', unlockAtWalks: 15, aspect: '4:5', colorways: [] },
  { id: 'editorial', name: 'Editorial', unlockAtWalks: 30, aspect: '4:5', colorways: [] },
  { id: 'cartographer', name: 'Cartographer', unlockAtWalks: 50, aspect: '9:16', colorways: [] },
  { id: 'signature', name: 'Signature', unlockAtWalks: 100, aspect: '9:16', colorways: [] },
];

export function getTemplateDef(id: MomentTemplateId): MomentTemplateDef {
  const def = MOMENT_TEMPLATES.find((t) => t.id === id);
  if (!def) throw new Error(`Unknown moment template: ${id}`);
  return def;
}

/** Persisted award id for a gated template — the pet_milestones row key. */
export function templateAwardId(id: MomentTemplateId): string {
  return `template_${id}`;
}

/**
 * The pet's current library: gates the walk count clears now, plus anything
 * the DB already remembers (so an unlock survives even if old walk rows are
 * ever pruned). Always contains the default template.
 */
export function unlockedTemplateIds(
  walkCount: number,
  awardedIds: Iterable<string>,
): Set<MomentTemplateId> {
  const awarded = new Set(awardedIds);
  const out = new Set<MomentTemplateId>();
  for (const t of MOMENT_TEMPLATES) {
    if (t.unlockAtWalks === null || walkCount >= t.unlockAtWalks || awarded.has(templateAwardId(t.id))) {
      out.add(t.id);
    }
  }
  return out;
}

/** Gated templates the count has crossed that aren't persisted yet, in
 *  ladder order. The award/celebration path in pawPrintsSync consumes this. */
export function detectTemplateUnlocks(
  walkCount: number,
  awardedIds: Iterable<string>,
): MomentTemplateDef[] {
  const awarded = new Set(awardedIds);
  return MOMENT_TEMPLATES.filter(
    (t) =>
      t.unlockAtWalks !== null &&
      walkCount >= t.unlockAtWalks &&
      !awarded.has(templateAwardId(t.id)),
  );
}

/** The nearest still-locked gate — powers every progress line. Null once the
 *  ladder is fully climbed. */
export function nextTemplateUnlock(
  walkCount: number,
): { def: MomentTemplateDef; remaining: number } | null {
  for (const t of MOMENT_TEMPLATES) {
    if (t.unlockAtWalks !== null && walkCount < t.unlockAtWalks) {
      return { def: t, remaining: t.unlockAtWalks - walkCount };
    }
  }
  return null;
}

// ── Copy ────────────────────────────────────────────────────────────────────

/** The chip under a locked card in the picker: "Unlocks at 15 walks". */
export function lockedGateLine(def: MomentTemplateDef): string {
  return `Unlocks at ${def.unlockAtWalks} walks`;
}

/** Replaces the share button while a locked card is selected. */
export function lockedProgressLine(def: MomentTemplateDef, walkCount: number): string {
  const remaining = Math.max(1, (def.unlockAtWalks ?? 0) - walkCount);
  return remaining === 1
    ? `One more walk unlocks the ${def.name} card`
    : `${remaining} more walks unlock the ${def.name} card`;
}

/** The goal-gradient chip on the summary and gallery surfaces. */
export function nextTemplateChipLine(walkCount: number): string | null {
  const next = nextTemplateUnlock(walkCount);
  if (!next) return null;
  return next.remaining === 1
    ? `One walk to the ${next.def.name} card`
    : `${next.remaining} walks to the ${next.def.name} card`;
}

/** The unlock celebration's one calm line — the card, not the count. */
export function templateUnlockLine(def: MomentTemplateDef): string {
  return `The ${def.name} card is yours now.`;
}

// ── Colorways ───────────────────────────────────────────────────────────────

export interface MomentColorwayDef {
  id: MomentColorwayId;
  name: string;
  premiumOnly: boolean;
}

export const MOMENT_COLORWAYS: MomentColorwayDef[] = [
  { id: 'classic', name: 'Classic', premiumOnly: false },
  { id: 'dusk', name: 'Dusk', premiumOnly: true },
];

/** Colorways this template can wear for this user. Classic always leads. */
export function availableColorways(
  def: MomentTemplateDef,
  isPremium: boolean,
): MomentColorwayDef[] {
  return MOMENT_COLORWAYS.filter(
    (c) => c.id === 'classic' || (def.colorways.includes(c.id) && isPremium),
  );
}
