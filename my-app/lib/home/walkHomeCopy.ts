/**
 * Walk Home copy — the header meta line and the editorial voice line that sit
 * over the map canopy on Home.
 *
 * Pure functions, no React and no I/O, so the brand voice is unit-testable
 * (walkHomeCopy.test.ts) exactly the way lib/walksign/copy.ts is. All strings
 * comply with the Pawtchi Copy Spec v1: no exclamation marks, never "your pet",
 * calm sentence case, the pet's name and correct pronoun where known.
 *
 * A deliberate omission: the design's line reads "It's 18°, dry, and his usual
 * hour." We do not say anything about the weather here. Live conditions need a
 * coordinate, and the location permission this app asks for is scoped to "during
 * a tracked walk" — quietly widening it to power a decorative clause would be
 * both a store-compliance problem and a promise we did not make. The line is
 * built from what we already know: when they last walked, and whether this is
 * the hour they usually go.
 */

import { possessivePronoun } from '../referral';

/** Width of the hour buckets the "usual hour" signal is folded into. */
const USUAL_HOUR_SLOT_H = 3;
/** Below this many walks there is no routine to speak of. */
const USUAL_HOUR_MIN_WALKS = 4;
/** Share of walks that must land in the modal slot for it to be "usual". */
const USUAL_HOUR_MIN_SHARE = 0.4;

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function cleanName(name?: string | null): string | null {
  const trimmed = (name ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Whole hours between two instants, floored, never negative. */
function hoursSince(from: number, now: number): number {
  return Math.max(0, Math.floor((now - from) / 3_600_000));
}

/**
 * "6h since last walk" / "2 days since last walk" / "no walks yet".
 * Deliberately concrete rather than shaming — a fact, not a scold.
 */
export function formatSinceLastWalk(
  lastWalkAt?: string | number | null,
  now: number = Date.now(),
): string {
  const t = lastWalkAt == null ? NaN : new Date(lastWalkAt).getTime();
  if (!Number.isFinite(t)) return 'no walks yet';

  const hours = hoursSince(t, now);
  if (hours < 1) return 'walked just now';
  if (hours < 24) return `${hours}h since last walk`;

  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day since last walk' : `${days} days since last walk`;
}

/**
 * The small line under the PAWTCHI wordmark:
 *   "Sun · Jul 26 · 6h since last walk"
 * Replaces the ad-hoc date builder that used to live inside the Home screen.
 */
export function buildHeaderMeta(
  lastWalkAt?: string | number | null,
  now: number = Date.now(),
): string {
  const d = new Date(now);
  const date = `${DAYS[d.getDay()]} · ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return `${date} · ${formatSinceLastWalk(lastWalkAt, now)}`;
}

/**
 * The hour of day this dog usually walks, or null when no routine has formed.
 *
 * Folded into 3-hour slots so "usually the 8am walk" survives a dog that leaves
 * at 07:50 one day and 09:10 the next. Returns the slot's start hour.
 */
export function deriveUsualHour(
  startedAts: readonly (string | number)[],
): number | null {
  const slots = new Map<number, number>();
  let counted = 0;

  for (const raw of startedAts) {
    const t = new Date(raw).getTime();
    if (!Number.isFinite(t)) continue;
    const slot = Math.floor(new Date(t).getHours() / USUAL_HOUR_SLOT_H) * USUAL_HOUR_SLOT_H;
    slots.set(slot, (slots.get(slot) ?? 0) + 1);
    counted += 1;
  }

  if (counted < USUAL_HOUR_MIN_WALKS) return null;

  let bestSlot: number | null = null;
  let bestCount = 0;
  for (const [slot, count] of slots) {
    if (count > bestCount) {
      bestSlot = slot;
      bestCount = count;
    }
  }

  if (bestSlot === null || bestCount / counted < USUAL_HOUR_MIN_SHARE) return null;
  return bestSlot;
}

/** True when `now` falls inside the dog's usual 3-hour walking slot. */
export function isUsualHourNow(usualHour: number | null, now: number = Date.now()): boolean {
  if (usualHour === null) return false;
  const hour = new Date(now).getHours();
  return hour >= usualHour && hour < usualHour + USUAL_HOUR_SLOT_H;
}

export interface VoiceLineInput {
  petName?: string | null;
  gender?: string | null;
  /** Most recent walk's start time; null/absent means no walks on record. */
  lastWalkAt?: string | number | null;
  /** Start hour of the dog's usual 3-hour slot, from deriveUsualHour. */
  usualHour?: number | null;
  now?: number;
}

/**
 * The editorial line over the map — one sentence, in display type, that states
 * where the day stands. Four honest cases, in the order they get checked:
 *
 *   no walks ever  → an invitation, not an empty state
 *   walked today   → an acknowledgement; nothing is owed
 *   usual hour     → the routine noticed out loud
 *   otherwise      → the plain fact of how long it has been
 */
export function buildVoiceLine(input: VoiceLineInput): string {
  const { petName, gender, lastWalkAt, usualHour = null, now = Date.now() } = input;
  const name = cleanName(petName);
  const who = name ?? 'this dog';
  const their = possessivePronoun(gender);

  const t = lastWalkAt == null ? NaN : new Date(lastWalkAt).getTime();
  if (!Number.isFinite(t)) {
    return name
      ? `${name} has a first walk waiting.`
      : 'There is a first walk waiting.';
  }

  const hours = hoursSince(t, now);

  if (hours < 6) {
    return name
      ? `${name} has already been out today.`
      : 'They have already been out today.';
  }

  if (isUsualHourNow(usualHour, now)) {
    return `It is ${their} usual hour.`;
  }

  if (hours < 24) {
    return `${hours} hours since ${who} last went out.`;
  }

  const days = Math.floor(hours / 24);
  return days === 1
    ? `It has been a day since ${who} last went out.`
    : `It has been ${days} days since ${who} last went out.`;
}
