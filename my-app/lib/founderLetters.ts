// Client helpers for "Write to the Founder".
//
// Thin wrappers over the founder_letters tables and their two RPCs. There is no
// edge function here on purpose — nothing in this flow holds a secret or calls
// a vendor, so a SECURITY DEFINER RPC behind RLS is the whole server.
//
// The 3-per-24h cap lives in submit_founder_letter(); `remainingToday()` below
// is for display only and must never be treated as the enforcement point.

import Constants from 'expo-constants';
import { supabase } from './supabase';
import { appError, toAppError, type AppError } from './appError';
import { FOUNDER_DISPLAY_NAME } from './notifications/copy';

/**
 * Who signs the letter. Named humans are the entire mechanism — people write to
 * people, not to a company — so this is one constant, not a string scattered
 * across three screens.
 *
 * It lives in the notification copy catalogue because that file is byte-mirrored
 * to the edge runtime, which also needs the names for the "wrote back" push. One
 * source, both sides.
 *
 * Plural: anything interpolating this needs a plural verb. Prefer "we" in the
 * screens where the sentence allows it.
 */
export const FOUNDER_NAMES = FOUNDER_DISPLAY_NAME;
export const FOUNDER_ROLE = 'who make Pawtchi';

/**
 * The label on every door into this feature — rows, buttons, the quick action.
 *
 * Deliberately NOT built from FOUNDER_NAMES. An entry point has to say what it
 * does to someone who has never heard the names, while the names belong to the
 * moments that are actually personal: the signature, the reply, the receipt.
 * Keeping them separate means neither can drift into the other.
 */
export const WRITE_TO_FOUNDER_LABEL = 'Write to Founder';

/** Mirrors the CHECK constraint on founder_letters.body. */
export const LETTER_MAX_CHARS = 2000;

/** Mirrors the cap inside submit_founder_letter(). Display only. */
export const LETTERS_PER_DAY = 3;

/**
 * Which door the owner came through. Instrumented because the Home Screen
 * quick action costs a native rebuild, and we should find out whether it earns it.
 */
export type LetterEntrySource = 'quick_action' | 'profile' | 'cancel_intent';

export interface FounderReply {
  id: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export interface FounderLetter {
  id: string;
  body: string;
  createdAt: string;
  reply: FounderReply | null;
}

interface LetterRow {
  id: string;
  body: string;
  created_at: string;
  founder_letter_replies: {
    id: string;
    body: string;
    created_at: string;
    read_at: string | null;
  }[] | null;
}

function toLetter(row: LetterRow): FounderLetter {
  // The unique index on letter_id guarantees at most one reply, so the embedded
  // array is either empty or a single element.
  const r = row.founder_letter_replies?.[0];
  return {
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    reply: r
      ? { id: r.id, body: r.body, createdAt: r.created_at, readAt: r.read_at }
      : null,
  };
}

/**
 * Every letter this owner has written, newest first, with its reply if one has
 * landed. RLS scopes both tables to the caller, so no owner filter is needed.
 */
export async function listLetters(): Promise<FounderLetter[]> {
  const { data, error } = await supabase
    .from('founder_letters')
    .select('id, body, created_at, founder_letter_replies(id, body, created_at, read_at)')
    .order('created_at', { ascending: false });

  if (error) throw toAppError(error);
  return (data as LetterRow[] | null)?.map(toLetter) ?? [];
}

export async function getLetter(id: string): Promise<FounderLetter | null> {
  const { data, error } = await supabase
    .from('founder_letters')
    .select('id, body, created_at, founder_letter_replies(id, body, created_at, read_at)')
    .eq('id', id)
    .maybeSingle();

  if (error) throw toAppError(error);
  return data ? toLetter(data as LetterRow) : null;
}

/**
 * How many letters are left in the caller's rolling 24h window. Used to show
 * calm copy *before* someone writes 2000 characters and then gets refused.
 */
export async function remainingToday(): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from('founder_letters')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', since);

  if (error) throw toAppError(error);
  return Math.max(0, LETTERS_PER_DAY - (count ?? 0));
}

/**
 * Send a letter. Returns the new letter's id.
 *
 * The cap is enforced in the RPC, which raises `daily_cap_reached`. That is a
 * deliberate, expected outcome rather than a fault, so it is translated into a
 * `rate_limited` AppError — the one error kind whose copy already says "not
 * right now" instead of "something went wrong".
 */
export async function submitLetter(input: {
  body: string;
  entrySource: LetterEntrySource;
  petId?: string | null;
}): Promise<string> {
  const body = input.body.trim();
  if (!body) throw appError('validation', 'submitLetter called with an empty body');

  const { data, error } = await supabase.rpc('submit_founder_letter', {
    p_body: body.slice(0, LETTER_MAX_CHARS),
    p_entry_source: input.entrySource,
    p_pet_id: input.petId ?? null,
    p_app_version: Constants.expoConfig?.version ?? null,
  });

  if (error) {
    if (error.message?.includes('daily_cap_reached')) {
      throw appError('rate_limited', 'founder letter daily cap reached');
    }
    throw toAppError(error);
  }
  return data as string;
}

/**
 * Stamp a reply as read. Owners have no UPDATE policy on replies by design, so
 * this runs definer-side.
 *
 * Best-effort: a failed read receipt must never stop someone reading their
 * reply, so this swallows rather than throws.
 */
export async function markReplyRead(letterId: string): Promise<void> {
  try {
    await supabase.rpc('mark_founder_reply_read', { p_letter_id: letterId });
  } catch {
    // Non-fatal by design.
  }
}

export type { AppError };
