/**
 * Every user-facing string in the creator programme, in one file.
 *
 * Same arrangement as lib/proOffer/copy.ts: strings live apart from the screens
 * so the brand voice can be asserted in a unit test rather than reviewed by
 * eye. `copy.test.ts` enforces Copy Spec v1 §6.04 against everything exported
 * here.
 *
 * ── The two rules specific to this feature ──────────────────────────────────
 *
 * 1. It is a CREATOR CODE. Never a "promo code", never an "offer code", never a
 *    "voucher". Those first two are the names of App Store and Play Console
 *    features, and a screen that borrows them invites a reviewer to read ours
 *    as the store's own redemption sheet — which is a rejection, not a
 *    misunderstanding. The word is load-bearing, not stylistic.
 *
 * 2. No prices, anywhere on the redeem screen. Paywall pricing is data-driven
 *    from RevenueCat for store-compliance reasons; a hardcoded "then $9.99" on
 *    an adjacent screen re-opens exactly the hole that rule closed. This screen
 *    talks about time, never money.
 *
 * A third thing worth naming: nothing here says "free trial". A trial implies a
 * card and a charge at the end, and this grants neither — RevenueCat drops the
 * entitlement and nobody is billed. Calling it a trial would be a small lie
 * that becomes a chargeback dispute.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * "6 December" — day and month, no year, no weekday.
 *
 * Hand-formatted rather than `toLocaleDateString` because this string is
 * asserted in unit tests, and Intl output shifts with the runtime's ICU build.
 * A test that passes on a developer's machine and fails in CI over a comma is
 * not worth the locale awareness we would gain.
 */
export function formatUntilDate(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

// ── The redeem screen (audience) ────────────────────────────────────────────

export const REDEEM_EYEBROW = 'Creator code';

/** Display face, all caps — the house convention for a screen headline. */
export const REDEEM_HEADLINE = 'THREE MONTHS, ON US';

export const REDEEM_SUBCOPY =
  'If someone you follow shared a code, enter it here. Three months of Pawtchi Plus opens up, with nothing to pay and no card needed.';

export const REDEEM_FIELD_LABEL = 'Your code';
export const REDEEM_FIELD_PLACEHOLDER = 'SARAHK';
export const REDEEM_CTA = 'Unlock three months';
export const REDEEM_CTA_WORKING = 'Opening Pawtchi Plus…';

export const REDEEM_WORKING_TITLE = 'UNLOCKING PREMIUM';
export const REDEEM_WORKING_BODY = 'Checking your creator code.';

/**
 * Sits under the field. Says the one thing people actually worry about before
 * typing a code into an app, which is whether it will start charging them.
 */
export const REDEEM_REASSURANCE = 'No payment details, and nothing renews at the end.';

// ── Outcomes ────────────────────────────────────────────────────────────────

/** Every outcome the edge function can report, plus the client-side failures. */
export type RedeemOutcome =
  | 'not_found'
  | 'inactive'
  | 'code_expired'
  | 'code_exhausted'
  | 'already_redeemed'
  | 'ever_subscribed'
  | 'own_code'
  | 'failed';

/**
 * One sentence per outcome, and each one tells the person what is actually
 * true rather than a shared apology.
 *
 * The distinctions matter more here than they look. "Already used a code" and
 * "that code has all been claimed" send someone to two different next actions —
 * one should stop, the other should ask the creator. A single "that didn't
 * work" for both produces a support ticket either way.
 */
export function redeemFailureCopy(
  outcome: RedeemOutcome,
  creatorName?: string | null,
): string {
  const name = (creatorName ?? '').trim();

  switch (outcome) {
    case 'not_found':
      return 'That code is not one we recognise. Check the spelling and try it again.';
    case 'inactive':
      return 'That code is no longer being accepted.';
    case 'code_expired':
      return 'That code has passed its end date.';
    case 'code_exhausted':
      return name
        ? `Every code ${name} shared has been claimed.`
        : 'Every code shared under that name has been claimed.';
    case 'already_redeemed':
      // Naming the one-per-account rule closes the loop. Without it the obvious
      // read is that something is broken, and the obvious next step is to try
      // again with a different code, which fails identically.
      return 'You have already used a creator code, and there is one per account.';
    case 'ever_subscribed':
      return 'Creator codes are for accounts that have not subscribed before.';
    case 'own_code':
      return 'This is your own code. Share it with the people who watch you.';
    case 'failed':
    default:
      return 'That did not go through. Give it a moment and try again.';
  }
}

// ── Success ─────────────────────────────────────────────────────────────────

export const REDEEM_SUCCESS_EYEBROW = 'Pawtchi Plus';
export const REDEEM_SUCCESS_TITLE = 'PREMIUM UNLOCKED';
export const REDEEM_SUCCESS_NOTE = 'No charge. Nothing renews.';
export const REDEEM_SUCCESS_BENEFITS = [
  'Food scans',
  'Health insights',
  'Activity and walks',
  'Routine reminders',
] as const;

/**
 * Names the creator, because the person did this on their say-so and the
 * handover should be visible. Falls back to a name-free line rather than
 * inventing a stand-in.
 */
export function redeemSuccessBody(creatorName: string | null | undefined, until: Date): string {
  const name = (creatorName ?? '').trim();
  const date = formatUntilDate(until);
  return name
    ? `Three months of Pawtchi Plus, from ${name}. Everything is open until ${date}.`
    : `Three months of Pawtchi Plus. Everything is open until ${date}.`;
}

export const REDEEM_SUCCESS_CTA = 'View my profile';

// ── Membership card and paywall, for someone on granted access ──────────────

export const PROMO_PLAN_LABEL = 'Pawtchi Plus';
export const PROMO_STATUS_LABEL = 'INCLUDED';

/** The membership card's detail line while a granted period is running. */
export function promoAccessDetail(until: Date): string {
  return `Open until ${formatUntilDate(until)} · Full access`;
}

/**
 * The paywall's already-covered state for a granted period.
 *
 * Deliberately does NOT offer "Manage subscription". There is no store
 * subscription behind a granted entitlement, so that button opens an empty
 * App Store page — a dead end that reads as a bug in our billing.
 */
export function promoPaywallBody(until: Date): string {
  return `Pawtchi Plus is open until ${formatUntilDate(until)}. Nothing is owed, and nothing renews.`;
}

// ── The creator's own screen ────────────────────────────────────────────────

export const CREATOR_EYEBROW = 'Your code';
export const CREATOR_HEADLINE = 'SHARE THE MONTHS';

export const CREATOR_SUBCOPY =
  'Anyone who enters this code gets three months of Pawtchi Plus. Say it out loud, put it in a caption, pin it in a comment.';

export const CREATOR_SHARE_ACTION = 'Share your code';

/**
 * The copy affordance is the platform's own text selection, not a button.
 *
 * A "Copy" button would mean adding expo-clipboard — a native module, and
 * therefore a new build — to save a long press on a string the creator already
 * knows by heart. `selectable` on the code Text gives the same result for free,
 * and this line is what makes it discoverable.
 */
export const CREATOR_HOLD_TO_COPY = 'Hold the code to copy it.';

/** Plain count. No chart, no percentage, no target to fall short of. */
export function creatorRedemptionLine(count: number): string {
  if (count === 0) return 'Nobody has used it yet.';
  if (count === 1) return 'One person has used it.';
  return `${count} people have used it.`;
}

export function creatorCompLine(until: Date): string {
  return `Your own Pawtchi Plus is open until ${formatUntilDate(until)}.`;
}

export const CREATOR_INACTIVE_NOTE = 'This code is paused. Get in touch before you share it.';

// ── What the creator earns ──────────────────────────────────────────────────

/**
 * Australian dollars per redemption. One number, one place.
 *
 * A rate in a component is a rate that gets copied into the next screen and
 * then disagrees with this one — and two different answers to "what do I earn"
 * is the kind of discrepancy a creator screenshots.
 */
export const CREATOR_RATE_AUD = 1;

/**
 * Money on this screen is the one exception to the no-prices rule at the top of
 * this file, and it is a different thing entirely.
 *
 * That rule exists because a hardcoded PRICE of Pawtchi Plus, shown to someone
 * who might buy it, contradicts the RevenueCat-driven paywall and re-opens a
 * store-compliance hole. This is not a price and this reader is not a buyer:
 * it is what we owe a creator for work they have already done. The copy test
 * carves this out by name rather than by pattern, so the rule still holds
 * everywhere else.
 *
 * Formatted as A$ rather than a bare $ because creators are not all in
 * Australia, and "$12" to someone in Toronto is a different promise than the
 * one we are making.
 */
export function formatAud(amount: number): string {
  return `A$${Math.max(0, Math.round(amount))}`;
}

/** Earnings follow redemptions exactly — comps are not redemptions. */
export function creatorEarningsAud(redemptions: number): number {
  return Math.max(0, Math.floor(redemptions)) * CREATOR_RATE_AUD;
}

export const CREATOR_EARNINGS_LABEL = 'Earned so far';

export const CREATOR_EARNINGS_RATE = `${formatAud(CREATOR_RATE_AUD)} for every person who uses your code.`;

/**
 * Nothing is paid out until the balance reaches this.
 *
 * Shown from the first redemption rather than revealed when someone asks to be
 * paid — the same rule met and discovered are very different experiences.
 */
export const CREATOR_PAYOUT_THRESHOLD_AUD = 100;

export const CREATOR_PAYOUT_NOTE = `Paid once you reach ${formatAud(CREATOR_PAYOUT_THRESHOLD_AUD)}.`;

/** Both sentences, always — the rate is meaningless without the threshold. */
export const CREATOR_EARNINGS_NOTE = `${CREATOR_EARNINGS_RATE} ${CREATOR_PAYOUT_NOTE}`;

/**
 * The message the share sheet sends.
 *
 * Written to be sent BY the creator TO their audience, so it is in their voice
 * addressing them — not our voice addressing the creator. Reuses the shape of
 * lib/referral.ts's invite message for the same reason: it has to survive being
 * pasted into a caption without reading like an ad we wrote.
 */
export function creatorShareMessage(code: string): string {
  return `Use the code ${code} in Pawtchi and you get three months of Pawtchi Plus, on them. It is where I keep track of everything for my dog.`;
}
