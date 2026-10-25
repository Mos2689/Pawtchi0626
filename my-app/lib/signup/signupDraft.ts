/**
 * The dog someone described before their account existed.
 *
 * Sign-up v2 asks for the dog first and the account last, so between "Create
 * account" and the pet row being written the dog lives here: in memory for
 * the auth gate (which must decide synchronously) and in AsyncStorage so an
 * email-confirmation detour or an app restart never loses it.
 *
 * Saved when "Create account" is pressed, read by onboarding/finish (and by
 * confirm-email before it verifies, to re-warm memory after a restart), and
 * cleared once the pet exists.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface SignupDraft {
  name: string;
  /** Local file uri of the prepared photo; uploaded after sign-up. */
  imageUri: string | null;
  breed: string | null;
  ageYears: number | null;
  firstDog: boolean | null;
  householdWalkers: number | null;
  /** Wanted handle, already normalised; '' when skipped. */
  username: string;
}

export const SIGNUP_DRAFT_KEY = 'pawtchi.signupDraft.v1';

let memory: SignupDraft | null = null;

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Anything without a name is not a dog we can save. */
export function normalizeDraft(raw: unknown): SignupDraft | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const name = str(r.name)?.trim();
  if (!name) return null;
  return {
    name,
    imageUri: str(r.imageUri),
    breed: str(r.breed),
    ageYears: num(r.ageYears),
    firstDog: typeof r.firstDog === 'boolean' ? r.firstDog : null,
    householdWalkers: num(r.householdWalkers),
    username: typeof r.username === 'string' ? r.username : '',
  };
}

export async function saveSignupDraft(draft: SignupDraft): Promise<void> {
  memory = draft;
  try {
    await AsyncStorage.setItem(SIGNUP_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Memory still carries it for this session.
  }
}

/** Reads storage into memory and returns it. Null when there is none. */
export async function loadSignupDraft(): Promise<SignupDraft | null> {
  if (memory) return memory;
  try {
    const raw = await AsyncStorage.getItem(SIGNUP_DRAFT_KEY);
    memory = raw ? normalizeDraft(JSON.parse(raw)) : null;
  } catch {
    memory = null;
  }
  return memory;
}

/** Synchronous, for the auth gate. Only knows what is in memory. */
export function hasSignupDraft(): boolean {
  return memory !== null;
}

export function getSignupDraft(): SignupDraft | null {
  return memory;
}

export async function clearSignupDraft(): Promise<void> {
  memory = null;
  try {
    await AsyncStorage.removeItem(SIGNUP_DRAFT_KEY);
  } catch {
    // A stale entry is harmless: it is only read on a fresh sign-up.
  }
}

/** Tests only. */
export function resetSignupDraftMemoryForTests(): void {
  memory = null;
}
