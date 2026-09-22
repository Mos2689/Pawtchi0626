/**
 * What we currently know about the username somebody is typing.
 *
 * Split out from the field that shows it because the same five states have to
 * render identically in three places — onboarding, the one-time Together
 * prompt, and the owner's profile. The interesting logic is all in deciding
 * WHICH state applies and what may be said about it; that part is pure, so it
 * can be tested without a keyboard or a network.
 *
 * ── The rule that matters ───────────────────────────────────────────────────
 *
 * An availability check is a hint, never a verdict. The only thing that
 * actually decides is the unique index on `profiles(lower(username))`, at the
 * moment of the write. Between a check and a save, somebody else can take the
 * name. So:
 *
 *   - `taken` blocks the save, because we have positive evidence it will fail
 *     and letting it through means showing a database error instead.
 *   - `unknown` NEVER blocks. If the check itself could not run — offline, the
 *     RPC missing, a cold start — the save must still be attempted. Refusing to
 *     let someone continue because our optional reassurance failed would turn a
 *     network blip into a locked onboarding screen.
 *   - `checking` never blocks either. Waiting for a spinner to agree before a
 *     button lights up is how a fast typist ends up tapping a dead button.
 */

import { isValidUsername, normalizeUsername } from '../communityUsername';

export type UsernameStatus =
  /** Nothing typed. */
  | 'idle'
  /** Typed, but not a legal username yet — too short, or bad characters. */
  | 'invalid'
  /** It is what they already have. Free to keep, nothing to check. */
  | 'unchanged'
  /** Well-formed, the answer is in flight. */
  | 'checking'
  /** Nobody holds it. */
  | 'available'
  /** Somebody else holds it. */
  | 'taken'
  /** The check could not be made. Say so; do not pretend either way. */
  | 'unknown';

/**
 * The part that needs no network: is this worth asking the server about?
 *
 * Returns the settled state directly when there is one, or `checking` to mean
 * "well-formed and nobody has answered yet" — which is the caller's cue to go
 * and ask.
 */
export function localStatus(value: string, current?: string | null): UsernameStatus {
  const typed = normalizeUsername(value);
  if (!typed) return 'idle';
  if (!isValidUsername(typed)) return 'invalid';
  // Case and a leading @ are not a change. Someone editing their profile who
  // retypes their own handle should not be told it is taken by themselves.
  if (current && normalizeUsername(current) === typed) return 'unchanged';
  return 'checking';
}

/** May the save go ahead? Everything except the two states we know will fail. */
export function blocksSave(status: UsernameStatus): boolean {
  return status === 'invalid' || status === 'taken';
}

/**
 * The line under the field.
 *
 * Null where the field should fall back to its format hint — an empty field
 * has nothing to report, and narrating "checking…" for every keystroke makes a
 * calm field look busy. `unchanged` is deliberately quiet too: the person is
 * looking at the handle they already own.
 */
export function statusMessage(status: UsernameStatus, value: string): string | null {
  switch (status) {
    case 'invalid':
      return '3–24 lowercase letters, numbers or underscores.';
    case 'available':
      return `@${normalizeUsername(value)} is yours.`;
    case 'taken':
      return 'Taken. Try another.';
    case 'unknown':
      // Honest about both halves: we could not check, and it might still work.
      return 'We could not check that one. You can still try it.';
    case 'idle':
    case 'unchanged':
    case 'checking':
    default:
      return null;
  }
}

/** Which of the three tones the message is painted in. */
export function statusTone(status: UsernameStatus): 'neutral' | 'good' | 'bad' {
  if (status === 'available') return 'good';
  if (status === 'invalid' || status === 'taken') return 'bad';
  return 'neutral';
}

/**
 * Turn the RPC's answer into a state.
 *
 * `null` is the function's own "I cannot answer" — not signed in, or a value it
 * would not parse — and a thrown request lands here as null too. Both mean
 * unknown. Neither means available.
 */
export function statusFromAnswer(answer: boolean | null): UsernameStatus {
  if (answer === true) return 'available';
  if (answer === false) return 'taken';
  return 'unknown';
}
