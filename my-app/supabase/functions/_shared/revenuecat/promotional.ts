/**
 * Granting RevenueCat promotional entitlements.
 *
 * One helper, two callers (redeem-creator-code and grant-creator-comp), because
 * this request has two ways to fail silently and both of them should only ever
 * be got wrong once.
 *
 * ── Why a promotional entitlement at all ────────────────────────────────────
 *
 * app/_layout.tsx calls `Purchases.logIn(session.user.id)`, so the RevenueCat
 * app user id IS the Supabase user id. Granting here therefore lands in
 * `customerInfo.entitlements.active['Pawtchi Pro']` — the single object
 * SubscriptionProvider reads — with no change to the access model, no client
 * entitlement logic, and no expiry job. RevenueCat removes the entitlement
 * itself when the duration elapses.
 *
 * The trade-off is that no payment method is captured: at expiry access simply
 * ends. That is deliberate. Redemption without a card is the whole point for a
 * creator's audience, and because they never touched StoreKit their App Store
 * introductory offer is untouched — the standard paywall's free trial is still
 * there when the free months run out.
 */

/** Must match ENTITLEMENT_ID in providers/SubscriptionProvider.tsx. */
const ENTITLEMENT_ID = 'Pawtchi Pro';

/**
 * The durations RevenueCat accepts. Mirrors the CHECK constraint on
 * creator_codes.duration, so a value that reaches here has already been
 * validated by Postgres — this type exists to keep a typo from getting that
 * far in the first place.
 */
export type PromotionalDuration =
  | 'monthly'
  | 'two_month'
  | 'three_month'
  | 'six_month'
  | 'yearly';

/**
 * What RevenueCat actually grants, in days. Only used as a fallback for our own
 * `expires_at` bookkeeping column when the API response cannot be parsed —
 * RevenueCat remains authoritative for access, and these are its documented
 * lengths, not clean calendar months.
 */
const FALLBACK_DAYS: Record<PromotionalDuration, number> = {
  monthly: 31,
  two_month: 61,
  three_month: 92,
  six_month: 183,
  yearly: 365,
};

export interface GrantResult {
  ok: boolean;
  /** When access ends, read from RevenueCat's response where possible. */
  expiresAt: string | null;
  /** For the function log and the redemption row's error_detail. Never sent to a client. */
  detail?: string;
}

/**
 * Grants `duration` of the Pawtchi Pro entitlement to `appUserId`.
 *
 * Two things here are load-bearing and neither is obvious from the call site:
 *
 *   1. The entitlement identifier contains a SPACE ("Pawtchi Pro"). Dropped
 *      into the path raw it produces a malformed URL and a 404 that reads
 *      exactly like a misconfigured entitlement. encodeURIComponent is not
 *      defensive tidiness; without it this never works.
 *
 *   2. No `X-Platform` header. RevenueCat rejects secret-key requests that
 *      carry one with error 7243 — a guard against secret keys shipped inside
 *      app bundles. Adding it "for consistency" with the SDK's other calls
 *      breaks every grant.
 *
 * Never throws. A grant that fails must leave the caller free to mark the
 * redemption `failed` and let the user retry, not unwind the whole request.
 */
export async function grantPromotionalEntitlement(
  appUserId: string,
  duration: PromotionalDuration,
): Promise<GrantResult> {
  const secret = Deno.env.get('REVENUECAT_SECRET_KEY');
  if (!secret) {
    console.error('[revenuecat] REVENUECAT_SECRET_KEY is not configured');
    return { ok: false, expiresAt: null, detail: 'missing_secret_key' };
  }

  const url =
    `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}` +
    `/entitlements/${encodeURIComponent(ENTITLEMENT_ID)}/promotional`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
        // Intentionally nothing else. See the note above about X-Platform.
      },
      body: JSON.stringify({ duration }),
    });

    const text = await res.text();

    if (!res.ok) {
      // The body carries RevenueCat's own error code, which is the only useful
      // thing when this fails. It goes to the function log, never to a client.
      console.error('[revenuecat] grant failed', res.status, text.slice(0, 500));
      return { ok: false, expiresAt: null, detail: `http_${res.status}` };
    }

    return { ok: true, expiresAt: parseExpiry(text) ?? fallbackExpiry(duration) };
  } catch (e) {
    console.error('[revenuecat] grant threw', e);
    return { ok: false, expiresAt: null, detail: 'network_error' };
  }
}

/**
 * Pulls the entitlement's real expiry out of the returned subscriber object.
 *
 * Preferred over computing it locally because RevenueCat decides the actual
 * length, and a near-duplicate grant is answered with the EXISTING entitlement
 * rather than an extended one — in which case the computed date would be wrong
 * in the one situation where being wrong matters.
 *
 * Returns null on any surprise; the caller falls back rather than storing a
 * date it invented.
 */
function parseExpiry(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as {
      subscriber?: { entitlements?: Record<string, { expires_date?: string | null }> };
    };
    const expires = parsed?.subscriber?.entitlements?.[ENTITLEMENT_ID]?.expires_date;
    return typeof expires === 'string' && expires ? expires : null;
  } catch {
    return null;
  }
}

function fallbackExpiry(duration: PromotionalDuration): string {
  const ms = FALLBACK_DAYS[duration] * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + ms).toISOString();
}
