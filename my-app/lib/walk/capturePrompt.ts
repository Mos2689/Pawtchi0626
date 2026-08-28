/**
 * When to offer the camera during a walk.
 *
 * ── The problem this solves ──
 * An in-app camera cannot beat the native one to a spontaneous moment: the
 * phone is locked, the dog does something funny for two seconds, and the
 * lock-screen swipe wins every time. Competing there is a losing fight.
 *
 * So the walk camera does not compete there. It claims a different moment: the
 * long sniff. When a dog has been nose-down at the same spot for half a minute,
 * the owner is standing still with nothing to do and a free hand — and Pawtchi
 * is the only app on the phone that knows it is happening. That knowledge is
 * the entire differentiator, and this module is where it turns into an offer.
 *
 * ── The other half of the job is staying quiet ──
 * The prompt is only worth anything while it is rare. A walk with six polite
 * suggestions is a walk the user learns to swipe away, and after that the
 * feature is dead no matter how good the camera is. Every constant here exists
 * to keep the offer scarce.
 *
 * Pure — the caller owns the state (what it has already prompted for) and the
 * clock.
 */

import type { LiveSniff } from './walkSession';

/**
 * How long a sniff must run before it is worth interrupting.
 *
 * The detector RECORDS an episode at 15s, but 15s is not long enough to be sure
 * the owner has settled — plenty of those end with the dog moving on mid-
 * sentence. 30s is a stop the human has visibly accepted, which is exactly the
 * moment reaching for a phone feels natural rather than rushed.
 */
export const CAPTURE_PROMPT_DWELL_MS = 30_000;

/**
 * Most capture prompts in one walk.
 *
 * Two. One is a nudge, two is a pattern, three is nagging — and a dog that
 * sniffs constantly would otherwise generate a dozen.
 */
export const MAX_CAPTURE_PROMPTS_PER_WALK = 2;

/** Quiet period after any prompt, however it was answered. */
export const CAPTURE_PROMPT_COOLDOWN_MS = 5 * 60_000;

/**
 * A walk this young has not settled into itself yet.
 *
 * The first stop is usually ten metres from the front door, and being asked to
 * photograph it reads as pestering rather than noticing.
 */
export const CAPTURE_PROMPT_MIN_ELAPSED_MS = 3 * 60_000;

/** What the caller remembers between fixes. */
export interface CapturePromptState {
  /** `since` of the episode most recently prompted for, or null. */
  lastPromptedEpisode: number | null;
  /** When the last prompt was shown, or null. */
  lastPromptAt: number | null;
  /** Prompts shown so far this walk. */
  promptCount: number;
}

export interface CapturePromptInput {
  sniff: LiveSniff | null;
  now: number;
  walkStartedAt: number;
  state: CapturePromptState;
  /** False when the user has already captured something at this episode. */
  enabled?: boolean;
}

export const initialCapturePromptState: CapturePromptState = {
  lastPromptedEpisode: null,
  lastPromptAt: null,
  promptCount: 0,
};

/**
 * Should the capture prompt appear right now?
 *
 * Returns false in every ambiguous case. The cost of a missed prompt is one
 * photo that the end-of-walk import will very likely catch anyway; the cost of
 * an unwanted one is a user who stops reading them.
 */
export function shouldPromptCapture(input: CapturePromptInput): boolean {
  if (input.enabled === false) return false;

  const { sniff, now, state } = input;
  if (!sniff) return false;

  if (state.promptCount >= MAX_CAPTURE_PROMPTS_PER_WALK) return false;
  if (now - input.walkStartedAt < CAPTURE_PROMPT_MIN_ELAPSED_MS) return false;
  if (sniff.dwellMs < CAPTURE_PROMPT_DWELL_MS) return false;

  // One offer per investigation: the dwell keeps growing after the threshold,
  // and without this the prompt would re-fire on every fix for as long as the
  // dog kept sniffing.
  if (state.lastPromptedEpisode === sniff.since) return false;

  if (state.lastPromptAt != null && now - state.lastPromptAt < CAPTURE_PROMPT_COOLDOWN_MS) {
    return false;
  }

  return true;
}

/** Record that a prompt was shown. Call once, when it actually appears. */
export function markCapturePrompted(
  state: CapturePromptState,
  sniff: LiveSniff,
  now: number,
): CapturePromptState {
  return {
    lastPromptedEpisode: sniff.since,
    lastPromptAt: now,
    promptCount: state.promptCount + 1,
  };
}
