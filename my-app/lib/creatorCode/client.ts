/**
 * The impure edge of the creator programme: two network calls and nothing else.
 *
 * Same split as lib/proOffer/client.ts — everything that decides anything lives
 * in `normalize.ts` and `copy.ts`, which are pure and tested. A bug here can
 * lose a redemption; it cannot invent one, because the decision is made by
 * `claim_creator_code` inside a row lock in Postgres.
 *
 * Nothing is cached. The pro-offer client caches config and grants so the
 * paywall can paint without waiting on the network, but there is nothing here
 * worth the risk: a cached "you already redeemed" would be wrong the instant it
 * was stale, and the redeem screen is a deliberate act that can afford a round
 * trip.
 */

import { supabase } from '../supabase';
import { withTimeout } from '../withTimeout';
import { normalizeCreatorCode } from './normalize';
import type { RedeemOutcome } from './copy';

/**
 * Long enough for a cold edge function plus a RevenueCat round trip, short
 * enough that a stalled request does not leave someone staring at a spinner
 * wondering whether they have been charged.
 */
const REDEEM_TIMEOUT_MS = 20_000;

export type RedeemResult =
  | { ok: true; creatorName: string | null; expiresAt: Date | null }
  | { ok: false; outcome: RedeemOutcome; creatorName: string | null };

export interface MyCreatorCode {
  code: string;
  creatorName: string;
  isActive: boolean;
  redemptionsGranted: number;
  compExpiresAt: Date | null;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Submits a code for redemption.
 *
 * Every failure — network, timeout, a 500, a refusal — comes back as a resolved
 * `{ ok: false }` with an outcome the copy module has a sentence for. Throwing
 * would push error handling into the screen, and the screen's job is to render
 * one of nine known states, not to classify exceptions.
 */
export async function redeemCreatorCode(rawCode: string): Promise<RedeemResult> {
  const code = normalizeCreatorCode(rawCode);

  try {
    const { data, error } = await withTimeout(
      supabase.functions.invoke('redeem-creator-code', { body: { code } }),
      REDEEM_TIMEOUT_MS,
      'redeem-creator-code',
    );

    // A non-2xx from the function lands in `error`, and its body — where the
    // `reason` lives — is not exposed here. That is fine: the function only
    // returns non-2xx for genuine failures (auth, rate limit, server), all of
    // which are 'failed' to the reader.
    if (error) return { ok: false, outcome: 'failed', creatorName: null };

    if (data?.success === true) {
      return {
        ok: true,
        creatorName: typeof data.creator_name === 'string' ? data.creator_name : null,
        expiresAt: parseDate(data.expires_at),
      };
    }

    const reason = typeof data?.reason === 'string' ? data.reason : 'failed';
    return {
      ok: false,
      outcome: reason as RedeemOutcome,
      creatorName: typeof data?.creator_name === 'string' ? data.creator_name : null,
    };
  } catch {
    return { ok: false, outcome: 'failed', creatorName: null };
  }
}

/**
 * The signed-in user's own creator code, or null.
 *
 * Null for very nearly everyone, which is exactly how Profile decides whether
 * to render the Creator row — there is no separate "is a creator" flag to keep
 * in sync with the code table. Also null on any error: a creator seeing their
 * row disappear for one render is a smaller failure than an error screen in a
 * settings list.
 */
export async function loadMyCreatorCode(): Promise<MyCreatorCode | null> {
  try {
    const { data, error } = await supabase.rpc('get_my_creator_code');
    if (error) throw error;

    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    if (!row || typeof row.code !== 'string') return null;

    return {
      code: row.code,
      creatorName: typeof row.creator_name === 'string' ? row.creator_name : '',
      isActive: row.is_active === true,
      redemptionsGranted:
        typeof row.redemptions_granted === 'number' ? row.redemptions_granted : 0,
      compExpiresAt: parseDate(row.comp_expires_at),
    };
  } catch {
    return null;
  }
}
