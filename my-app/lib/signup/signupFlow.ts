/**
 * Sign-up v2 — the steps, their order, and what lets each one continue.
 *
 * The dog comes first, one question per screen, and the account comes last:
 * by the time someone is asked for an email they have already told us their
 * dog's name, photo and age, which is a reason to finish rather than a form
 * to abandon. Everything here is pure so the rules are tested without a
 * device (signupFlow.test.ts).
 */

import { isValidUsername, normalizeUsername } from '../communityUsername';

export type SignupStepId = 'name' | 'photo' | 'breed' | 'age' | 'first_dog' | 'walkers' | 'account';

export const SIGNUP_STEPS: readonly SignupStepId[] = [
  'name',
  'photo',
  'breed',
  'age',
  'first_dog',
  'walkers',
  'account',
];

/** Steps that may be skipped. Name and the account are the only required ones. */
export const OPTIONAL_STEPS: ReadonlySet<SignupStepId> = new Set([
  'photo',
  'breed',
  'age',
  'first_dog',
  'walkers',
]);

/** 1-based, for analytics. */
export function signupStepIndex(step: SignupStepId): number {
  return SIGNUP_STEPS.indexOf(step) + 1;
}

/**
 * How far along the walk the progress marker sits: 0 on the first question,
 * 1 only once the account exists (the finish screen), so the account step
 * itself reads as the last stretch rather than as arrived.
 */
export function signupProgress(stepIndex0: number): number {
  const total = SIGNUP_STEPS.length;
  return Math.max(0, Math.min(1, stepIndex0 / total));
}

/**
 * Age as a short row of taps (the same choices onboarding/identity offers).
 * Good enough for a life stage and the provisional Walksign.
 */
export const AGE_CHOICES: readonly { label: string; years: number }[] = [
  { label: 'Puppy', years: 0.5 },
  { label: '1', years: 1 },
  { label: '2', years: 2 },
  { label: '3', years: 3 },
  { label: '4', years: 4 },
  { label: '5', years: 5 },
  { label: '6', years: 6 },
  { label: '7', years: 7 },
  { label: '8', years: 8 },
  { label: '9', years: 9 },
  { label: '10+', years: 10 },
];

/** The breeds offered as one-tap chips; the search covers the full list. */
export const POPULAR_BREEDS: readonly string[] = [
  'Mixed Breed',
  'Labrador Retriever',
  'Cavoodle',
  'French Bulldog',
  'Golden Retriever',
  'Border Collie',
  'Staffordshire Bull Terrier',
  'Groodle',
];

export const PASSWORD_MIN = 8;

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** 0–1, for the strength bar. Length-led; it reassures, it does not judge. */
export function passwordStrength(value: string): number {
  if (!value) return 0;
  let score = Math.min(value.length / 12, 1) * 0.7;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 0.1;
  if (/\d/.test(value)) score += 0.1;
  if (/[^A-Za-z0-9]/.test(value)) score += 0.1;
  return Math.min(1, Math.round(score * 100) / 100);
}

/**
 * The username field's format verdict. Empty is fine (it is optional); the
 * real availability check happens after sign-up, because the database only
 * answers signed-in callers.
 */
export function usernameFormat(value: string): 'empty' | 'ok' | 'bad' {
  const normalized = normalizeUsername(value);
  if (!normalized) return 'empty';
  return isValidUsername(normalized) ? 'ok' : 'bad';
}

export function canCreateAccount(input: { email: string; password: string; username: string }): boolean {
  return (
    isValidEmail(input.email) &&
    input.password.length >= PASSWORD_MIN &&
    usernameFormat(input.username) !== 'bad'
  );
}

/** A name to put in headings: the typed one, or a neutral stand-in. */
export function dogNameOrFallback(name: string): string {
  const trimmed = name.trim();
  return trimmed || 'your dog';
}

/**
 * Where the auth gate sends a brand-new account. With a sign-up v2 draft the
 * dog already exists on the phone and only needs saving; without one (flag
 * off, or an older route) the account goes to the classic identity screen.
 */
export function freshSignupDestination(hasDraft: boolean): '/onboarding/finish' | '/onboarding/identity' {
  return hasDraft ? '/onboarding/finish' : '/onboarding/identity';
}
