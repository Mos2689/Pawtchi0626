/**
 * The notification center's item contract.
 *
 * Before this existed, a "nudge" meant four unrelated things depending on which
 * screen you were on: the single winner from `lib/nudgeEngine.ts`, one of six
 * self-contained banner components on Home, a card wedged into the Health feed,
 * or a transient piece of Activity/Meal screen state. None of them had a
 * history, so a nudge that fired while the owner was on Meal was simply never
 * seen, and a push swiped out of the OS tray was gone for good.
 *
 * Everything now arrives here first, as an `InboxItem`, and the center is the
 * only thing that renders it.
 *
 * Kept import-light on purpose — this module is pulled in by the engine, the
 * store, the bell and the screen, and a cycle through any of those is a
 * debugging afternoon nobody needs.
 */

/** Where an item came from. Only ever used for analytics and ordering. */
export type InboxSource =
  /** Derived from lib/nudgeEngine.ts. */
  | 'nudge'
  /** Derived from a banner predicate in ./bannerRules.ts. */
  | 'banner'
  /** A real push we already sent, read back from notification_history. */
  | 'push'
  /** Published at runtime by a screen that detected something mid-session. */
  | 'runtime';

/**
 * How loud an item is allowed to be. This is the only thing that decides sort
 * order and badge colour, so it is deliberately a closed set of four rather
 * than a free-form severity number that every new rule would nudge upward.
 *
 * `clinical` is not "important" — it is specifically "a vet should be involved".
 * Nothing else may use it. It buys stickiness, top placement, and a red badge,
 * and those only stay meaningful while the tier stays small.
 */
export type InboxTone = 'clinical' | 'action' | 'info' | 'celebration';

/** Rank used for sorting. Lower sorts first. */
export const TONE_RANK: Record<InboxTone, number> = {
  clinical: 0,
  action: 1,
  info: 2,
  celebration: 3,
};

/** Tones that turn the bell badge red and light the tab dot. */
export function isUrgentTone(tone: InboxTone): boolean {
  return tone === 'clinical' || tone === 'action';
}

/**
 * Items whose action has a side effect rather than a destination.
 *
 * Two of the migrated banners wrote to the database from their own CTA
 * (`SevereObesityVetBanner` stamped `pets.severe_obesity_vet_confirmed_at`;
 * `MerRecalibrationBanner` wrote `pets.target_daily_calories` behind a confirm
 * modal). A deep link cannot carry that, so those items name an action instead
 * and the center resolves it in place.
 */
export type InboxActionId =
  /** Stamps severe_obesity_vet_confirmed_at. Owner asserts they saw a vet. */
  | 'confirm_vet_consult'
  /** Opens the MER recalibration confirm modal. */
  | 'review_mer_recalibration'
  /** Local-only acknowledgement; nothing is written server-side. */
  | 'acknowledge';

export interface InboxItem {
  /**
   * Stable across recomputes, and day-scoped where the underlying condition is.
   *
   * Load-bearing: read state is stored against this id, so an id that changes
   * whenever a calorie total wiggles would make every item unread again on the
   * next refresh. Always build it with `stableId()` — never inline a template
   * string at a call site.
   */
  id: string;
  source: InboxSource;
  tone: InboxTone;
  title: string;
  body: string;
  /** MaterialIcons glyph name. Kept as a plain string to avoid importing the icon set here. */
  icon: string;
  /** ISO. For derived items this is when the condition was first observed this cycle. */
  createdAt: string;
  /**
   * In-app route to open on tap, in the same string space `routeFor()` produces
   * in lib/notifications/deepLink.ts — so a push and a locally derived nudge
   * about the same thing land in exactly the same place.
   */
  route?: string;
  /** Resolved in place instead of navigating. Mutually exclusive with `route` in practice. */
  action?: InboxActionId;
  petId?: string | null;
  /**
   * Cannot be dismissed and never auto-reads. Clinical items set this: the
   * owner has to actually deal with them, not scroll past once.
   */
  sticky?: boolean;
  /** ISO. Past this, the item drops out of the feed on the next rebuild. */
  expiresAt?: string;
  /** Campaign key for `push` items, so a tap can be recorded as an open. */
  dedupeKey?: string;
  /** Free-form analytics context. Never rendered. */
  meta?: Record<string, string | number | boolean | null>;
}

/** Feed item with the store's read state folded in — what the screen renders. */
export interface InboxEntry extends InboxItem {
  read: boolean;
}

/**
 * Newest and loudest first.
 *
 * Tone outranks recency deliberately. A three-day-old "call your vet" outranks
 * a cheerful walk note from this morning, which is the whole reason the tone
 * tier exists.
 */
export function compareItems(a: InboxItem, b: InboxItem): number {
  const byTone = TONE_RANK[a.tone] - TONE_RANK[b.tone];
  if (byTone !== 0) return byTone;
  return b.createdAt.localeCompare(a.createdAt);
}
