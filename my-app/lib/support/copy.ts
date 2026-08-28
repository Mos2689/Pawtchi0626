// Every user-facing string in the support flow, in one file.
//
// Support speaks in a different voice from the founder letter, and the
// difference is deliberate. The letter is a person — first person, "we read
// every letter", unsigned. Support is the team: competent, unhurried,
// institutional. Two channels, two voices, so an owner always knows which one
// they are in even though neither one prints a name.
//
// That is why nothing here is signed with a name, and why SUPPORT_TEAM_NAME is
// a constant rather than an import from founderLetters.ts. If support ever
// needs to become a named human again, this is the one line to change.
//
// Copy Spec v1 (Brand Book §3.01–3.06, §6.04) applies to every string below:
//   • No exclamation marks. Anywhere.
//   • Sentence case in UI. The ALL-CAPS strings here are set in Bebas Neue,
//     which is an all-caps display face by construction (constants/design.ts),
//     or are `type.caption` eyebrows — the same precedent as app/letter/*.
//   • Three sentences maximum. End on an action, not a feeling.
//   • Plain Australian English. No emoji, no hype, none of the banned words.
//   • The animal is named where it is natural — but support is about the app,
//     not the animal, so most of this copy names neither. Forcing a pet's name
//     into "we could not read that receipt" is a non-sequitur.

import type { ErrorContext } from '../appError';

/** Who support speaks as. Deliberately institutional — see the note above. */
export const SUPPORT_TEAM_NAME = 'the Pawtchi team';

/** The label on every door into this feature — rows, buttons, deep links. */
export const SUPPORT_LABEL = 'Help & Support';

/** Mirrors the CHECK constraint on support_tickets.body. */
export const SUPPORT_MAX_CHARS = 2000;

/** Mirrors the cap inside submit_support_ticket(). Display only. */
export const TICKETS_PER_DAY = 5;

/**
 * The response window shown on the confirmation screen.
 *
 * This is a promise, and the daily cap above is what keeps it operationally
 * true — the same relationship the founder letter has between "we read every
 * letter" and its 3-per-24h cap. Do not soften the cap without softening this,
 * and do not tighten this without the volume to back it.
 */
export const RESPONSE_WINDOW = 'within 2 business days';

// ── Topics ──────────────────────────────────────────────────────────────────

export type SupportTopic = 'bug' | 'question';

/**
 * The composer is one screen for both topics. The topic changes the headline,
 * the placeholder and how prominent the screenshot row is — nothing else. A
 * second screen would have been two screens to keep in sync for no gain the
 * owner could perceive.
 */
export const TOPIC_COPY: Record<SupportTopic, {
  /** Bebas display headline — caps by construction. */
  headline: string;
  /** One calm line under the headline. */
  subtitle: string;
  placeholder: string;
  /** Screenshots matter more for "it looks wrong" than for "how does this work". */
  attachmentProminent: boolean;
}> = {
  bug: {
    headline: 'WHAT WENT WRONG',
    subtitle:
      'Tell us what happened in your own words. Everything about your device and the screen you were on comes through with it, so there is no need to describe any of that.',
    placeholder: 'What happened? Even one line helps — “the scan spun forever” is plenty.',
    attachmentProminent: true,
  },
  question: {
    headline: 'ASK US ANYTHING',
    subtitle:
      'Questions about how something works, your subscription, or your account all land in the same place. Ask in whatever way is easiest.',
    placeholder: 'What would you like to know?',
    attachmentProminent: false,
  },
};

// ── Areas ───────────────────────────────────────────────────────────────────

export type SupportArea =
  | 'meals'
  | 'walks'
  | 'health'
  | 'notifications'
  | 'subscription'
  | 'other';

export interface AreaOption {
  id: SupportArea;
  label: string;
  /** Walks are dogs-only and flag-gated, so this chip is not always offered. */
  walksOnly?: boolean;
}

/**
 * The only structured field the owner touches, and usually it arrives already
 * answered. Six options is the ceiling: past that, picking becomes a task in
 * itself and people start choosing "other" to escape the decision.
 */
export const AREA_OPTIONS: readonly AreaOption[] = [
  { id: 'meals', label: 'Meals & scanning' },
  { id: 'walks', label: 'Walks', walksOnly: true },
  { id: 'health', label: 'Health & weight' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'subscription', label: 'Subscription' },
  { id: 'other', label: 'Something else' },
];

/**
 * Where a failure came from → which area it belongs to.
 *
 * This is the mapping that makes the whole design work. When someone taps
 * "Contact support" on a failed food scan, the composer opens with
 * "Meals & scanning" already selected and they type one sentence. The
 * `prefilled` property on `support_compose_started` measures whether this is
 * landing; if it is usually wrong, tune the map rather than adding a step.
 */
const CONTEXT_TO_AREA: Record<ErrorContext, SupportArea> = {
  food_scan: 'meals',
  log: 'meals',
  vet_scan: 'health',
  ask_vet: 'health',
  report: 'health',
  pet_save: 'health',
  schedule: 'notifications',
  purchase: 'subscription',
  auth: 'other',
  account: 'other',
  render_crash: 'other',
  generic: 'other',
};

/** Best guess at the area, or null when there is nothing to guess from. */
export function areaFromContext(context?: ErrorContext | null): SupportArea | null {
  if (!context) return null;
  return CONTEXT_TO_AREA[context] ?? null;
}

/** The area chips this owner should see. Walks are dogs-only and flag-gated. */
export function visibleAreas(walkEnabled: boolean): AreaOption[] {
  return AREA_OPTIONS.filter((a) => !a.walksOnly || walkEnabled);
}

// ── Hub ─────────────────────────────────────────────────────────────────────

export const HUB_COPY = {
  eyebrow: 'PAWTCHI SUPPORT',
  headlineTop: 'HOW CAN',
  headlineHighlighted: 'WE HELP',
  intro:
    'Most questions have a quick answer below. If yours does not, write to us — a real person reads every message that comes through here.',
  faqEyebrow: 'COMMON QUESTIONS',
  requestsEyebrow: 'YOUR REQUESTS',
  /** Shown under the request list so the promise is visible before submitting. */
  requestsFooter: `${SUPPORT_TEAM_NAME[0].toUpperCase()}${SUPPORT_TEAM_NAME.slice(1)} answers ${RESPONSE_WINDOW}.`,
} as const;

export const DOOR_COPY = {
  bug: {
    title: 'Report a problem',
    subtitle: 'Something broke, or it looks wrong',
  },
  question: {
    title: 'Ask a question',
    subtitle: 'How something works, billing, your account',
  },
  idea: {
    title: 'Share an idea',
    subtitle: 'A letter straight to the people who make Pawtchi',
  },
} as const;

// ── Composer ────────────────────────────────────────────────────────────────

export const COMPOSER_COPY = {
  areaLabel: 'Which part of Pawtchi?',
  attachLabel: 'Add a screenshot',
  attachHint: 'Optional. One image.',
  attachReplace: 'Replace screenshot',
  attachRemove: 'Remove screenshot',
  diagnosticsLabel: 'What we send with this',
  diagnosticsHint:
    'So you do not have to describe your phone. No photos, no location, and nothing about what you have logged.',
  send: 'Send',
  sending: 'Sending…',
  /**
   * The cap is not an error, so it does not get error styling or error words.
   * Someone who has written five times today is someone trying hard to be
   * helped, and a red banner is the wrong way to meet that.
   */
  capTitle: `That is ${TICKETS_PER_DAY} requests today`,
  capBody:
    'We would rather answer those properly than take more. Write again tomorrow — we will still be here.',
} as const;

// ── Confirmation ────────────────────────────────────────────────────────────

/**
 * "We've got it" rather than "Ticket submitted" — a receipt, not a filing.
 *
 * The reference is deliberately small and secondary. It exists so a follow-up
 * message can point at something, not to imply a queue position or a system
 * with more machinery behind it than there is.
 */
export const CONFIRMATION_COPY = {
  title: 'We’ve got it',
  bodyLine: `Someone on ${SUPPORT_TEAM_NAME} will read this and get back to you ${RESPONSE_WINDOW}.`,
  replyLine: 'If there is a reply, it lands right here in the app, and we will let you know.',
  referenceLabel: 'Reference',
  done: 'Done',
} as const;

/**
 * A short, sayable reference derived from the ticket id.
 *
 * The first block of a UUID, uppercased. Not stored — it is a projection of the
 * id, so it can never drift out of sync with the row and needs no column.
 */
export function ticketReference(id: string): string {
  const head = (id || '').replace(/-/g, '').slice(0, 4).toUpperCase();
  return head ? `PAW-${head}` : 'PAW';
}

// ── Thread ──────────────────────────────────────────────────────────────────

export const THREAD_COPY = {
  youLabel: 'YOU WROTE',
  replyLabel: 'PAWTCHI SUPPORT REPLIED',
  /**
   * No reply yet. This must not read as a delivery failure, and must not
   * restate the response window as a countdown — a promise repeated back with
   * time attached becomes a deadline the owner starts watching.
   */
  pending: `${SUPPORT_TEAM_NAME[0].toUpperCase()}${SUPPORT_TEAM_NAME.slice(1)} has this. When there is a reply, it shows up right here.`,
  missingTitle: 'That request is not here',
  missingBody: 'It may have been removed. Your other requests are on the previous screen.',
} as const;

// ── Entry points ────────────────────────────────────────────────────────────

export type SupportEntrySource =
  | 'profile'
  | 'error_state'
  | 'paywall'
  | 'billing_row'
  | 'deep_link';

/**
 * The quiet link in the paywall footer, sitting beside Restore / Privacy /
 * Terms. Short because that row is short — "Questions about billing?" reads
 * well as a row label but wraps badly as a footer link.
 *
 * Subscribers never see the paywall, so their billing route is the
 * Help & Support row in Profile plus the two subscription FAQs on the hub.
 * The cancel-intent sheet deliberately stays a two-option decision: a third
 * door there would make leaving feel obstructed, which is the one thing that
 * flow must never do.
 */
export const BILLING_HELP_LABEL = 'Billing help';
