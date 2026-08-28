/**
 * Every user-facing string on the win-back paywall, in one file.
 *
 * Same arrangement as lib/support/copy.ts: strings live apart from the screen
 * so the brand voice can be asserted in a unit test rather than reviewed by
 * eye. `copy.test.ts` enforces Copy Spec v1 §6.04 against everything exported
 * here.
 *
 * ── The one rule that is specific to this screen ────────────────────────────
 *
 * The copy must never mention the dismissals, the refusals, or the fact that
 * the user did not subscribe. Not "since you passed on Pawtchi Plus", not
 * "still thinking about it?", not "we noticed you didn't upgrade".
 *
 * That is not squeamishness about tone. The entire premise of the eligibility
 * design is that nobody learns "close the paywall, get a cheaper Pawtchi" —
 * and copy that names the dismissal teaches exactly that in one sentence,
 * however carefully the five-day cooldown was built to hide it. The offer is
 * framed on how long they have been here, which is true, flattering, and
 * useless as a lever to game.
 *
 * The display headline is set in Bebas Neue, an all-caps face, matching the
 * standard paywall's "NOTICE EVERYTHING." That typographic caps is the
 * existing house convention for this one element; every other string here is
 * sentence case per the spec.
 */

import { possessivePronoun } from '../referral';

export interface OfferPet {
  name?: string | null;
  gender?: string | null;
}

function cleanName(name?: string | null): string | null {
  const trimmed = (name ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Eyebrow above the headline. Matches the standard paywall's brand pill. */
export const OFFER_EYEBROW = 'Pawtchi Plus';

/**
 * Two words, set in the display face. Ties to the locked tagline ("Notice
 * everything") and names what is actually lost — the noticing, not "a
 * subscription".
 */
export const OFFER_HEADLINE_LEAD = 'KEEP';
export const OFFER_HEADLINE_ACCENT = 'NOTICING';

/**
 * Three sentences at most, ending on what the offer is rather than on a
 * feeling. Named animal, sexed pronoun, no mention of the paywall history.
 */
export function offerSubcopy(pet?: OfferPet): string {
  const name = cleanName(pet?.name);
  if (!name) {
    // Deliberately makes no claim about how long the price lasts. That belongs
    // in the price block, where it is read off the live product — the subcopy
    // saying "for as long as you stay" would be false the moment `offering_id`
    // points at an introductory offer, which is what it points at today.
    return 'You have been walking with us a while. Here is Pawtchi Plus at a lower price.';
  }
  const pronoun = possessivePronoun(pet?.gender);
  return `You have been walking with us a while. Here is Pawtchi Plus at a lower price, so ${name} keeps ${pronoun} full picture.`;
}

/** Label above the struck-through reference price. Flat shape only. */
export const OFFER_STANDARD_LABEL = 'Standard price';

/**
 * Sits under the discounted price when the SKU is a plainly cheaper one —
 * a permanent rate while subscribed, not a first-month tease.
 *
 * NOT used for the introductory shape live today, where it would be false.
 * `offerTermLine` is used there instead.
 */
export const OFFER_PRICE_FOOTNOTE = 'Your price, for as long as you stay subscribed';

/**
 * The honest version of the same line for an introductory offer: how long the
 * discount lasts, and what happens after.
 *
 * Two sentences of plain fact, with no softening. A discounted price that
 * reverts is a perfectly good offer; a discounted price that reverts and does
 * not say so is a complaint to the App Store, and both stores require the term
 * and the post-offer price to be disclosed on the purchase screen anyway.
 */
export function offerTermLine(cycles: number, unit: string, basePriceString: string): string {
  const period = cycles === 1 ? unit : `${cycles} ${unit}s`;
  return `For your first ${period}, then ${basePriceString}/month`;
}

/** CTA. Price is interpolated live from StoreKit — never hardcoded. */
export function offerCtaLabel(priceString: string): string {
  return `Continue at ${priceString}`;
}

/**
 * The legal line, assembled from live store strings.
 *
 * Every price comes from the store product — the intro price from
 * `introPrice.priceString`, the recurring price from `product.priceString`.
 * This is the constraint a Play rejection has already been paid for: a
 * hardcoded price or term on a subscription screen is a store-compliance
 * failure, not a style preference.
 */
export function offerLegalLine(
  priceString: string,
  intro?: { cycles: number; unit: string; basePriceString: string } | null,
): string {
  if (!intro) return `${priceString}/month · Cancel anytime`;
  const period = intro.cycles === 1 ? intro.unit : `${intro.cycles} ${intro.unit}s`;
  return `${priceString}/month for ${period}, then ${intro.basePriceString}/month · Cancel anytime`;
}

/**
 * The expiry line. One honest sentence, no countdown timer.
 *
 * The window really is enforced server-side, so stating the date is
 * information rather than pressure — which is the only kind of urgency the
 * brand voice permits.
 */
export function offerExpiryLine(expiresAt: Date): string {
  const day = expiresAt.getDate();
  const month = expiresAt.toLocaleString('en-AU', { month: 'long' });
  return `Available until ${day} ${month}`;
}

// ── Notification centre entry ───────────────────────────────────────────────

export const OFFER_INBOX_TITLE = 'A lower price on Pawtchi Plus';

export function offerInboxBody(pet?: OfferPet): string {
  const name = cleanName(pet?.name);
  return name
    ? `Pawtchi Plus is available to you at a lower monthly price. Open it to see ${name}'s full picture.`
    : 'Pawtchi Plus is available to you at a lower monthly price. Open it to see the full picture.';
}

export const OFFER_INBOX_ICON = 'card-giftcard';
