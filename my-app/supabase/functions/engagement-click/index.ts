/**
 * engagement-click — the one hop between an emailed button and the app.
 *
 * ── The bug this exists to fix ──────────────────────────────────────────────
 *
 * Every email CTA pointed at `https://pawtchi.com/app/<slug>`, which opened a
 * browser on a blank page. Two independent reasons, either one fatal:
 *
 *   - The website has no `/app/*` route. `pawtchi-website/src/main.jsx` lists
 *     every path it serves and that is not one of them, so vercel.json rewrites
 *     it to index.html and React Router renders nothing at all.
 *   - iOS never claimed the domain. `app.json` keeps the associated domains
 *     under `__associatedDomains_temp` — an inert key — so no released iOS
 *     build has the entitlement a Universal Link needs.
 *
 * ── The contract ────────────────────────────────────────────────────────────
 *
 *   GET /engagement-click?s=<send-uuid>&t=<target>[&r=<resource-uuid>]
 *   → 302, Location: pawtchi:///(tabs)/health?engagement_send=<send-uuid>
 *
 * An empty 302 and nothing else. Not an HTML page, not a meta refresh, not a
 * script: Supabase rewrites `text/html` to `text/plain` on
 * *.supabase.co/functions/v1/* (a platform guard against hosting phishing on a
 * Supabase domain — verified against this project's deployed email-unsubscribe
 * function), so any "Opening the app…" interstitial would render to the owner
 * as a wall of source. The redirect is also simply better: the browser never
 * paints.
 *
 * ── Why this is safe to expose without a JWT ────────────────────────────────
 *
 * It has to be public — a mail client has no Supabase session. It is safe
 * because it carries no user authority and reads nothing:
 *
 *   - The destination comes from an allowlist of eight keys. There is no
 *     parameter that can name a URL, so it cannot be used as an open redirect.
 *   - Both identifiers are shape-checked as uuids before they touch the
 *     database or the Location header.
 *   - The only write is `clicked_at`, guarded by `IS NULL` so a forwarded link
 *     cannot rewrite the first click, and scoped to one row by primary key.
 *   - It returns no data, so a guessed uuid reveals nothing. The response is
 *     byte-identical for a real send id and a made-up one.
 *   - The service-role key never leaves this function. It is not in the app
 *     bundle, the email, the URL or the logs.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import {
  CTA_DEFAULT_TARGET,
  deepLinkFor,
  isCtaTarget,
} from '../_shared/email/links.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The redirect, and the only kind of response this function has.
 *
 * `no-store` because an intermediary caching a 302 keyed on the URL would be
 * harmless but pointless, and because the send id in the query string should
 * not sit in a shared cache. `no-referrer` so the click URL — which names a
 * ledger row — is never leaked onward in a Referer header.
 */
function appRedirect(deepLink: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: deepLink,
      'Cache-Control': 'no-store, max-age=0',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  const requestUrl = new URL(req.url);

  const rawSendId = requestUrl.searchParams.get('s');
  const rawTarget = requestUrl.searchParams.get('t');
  const rawResourceId = requestUrl.searchParams.get('r');

  // Every unknown value degrades to something that still opens the app. A
  // person tapped a button we put in front of them; a 400 in a browser is never
  // the right answer to our own typo.
  const safeTarget = isCtaTarget(rawTarget) ? rawTarget : CTA_DEFAULT_TARGET;
  const safeSendId = rawSendId && UUID_RE.test(rawSendId) ? rawSendId : null;
  const safeResourceId =
    rawResourceId && UUID_RE.test(rawResourceId) ? rawResourceId : null;

  const deepLink = deepLinkFor(safeTarget, safeResourceId, safeSendId);

  // HEAD is what link scanners in corporate mail gateways send. Answer with the
  // same headers and no side effect, so a scanner cannot burn the first click.
  if (req.method === 'HEAD') return appRedirect(deepLink);

  // ── Attribution, strictly best-effort ─────────────────────────────────────
  //
  // Deliberately awaited rather than fired and forgotten: the edge runtime may
  // tear the isolate down the moment the response is returned, which would drop
  // the write. It is wrapped so that no database failure — outage, missing
  // column, revoked key — can stand between an owner and the screen they asked
  // for. A lost click metric is a bad day; a dead button is a broken product.
  if (safeSendId) {
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

      if (supabaseUrl && serviceRoleKey) {
        const admin = createClient(supabaseUrl, serviceRoleKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        });

        // `IS NULL` makes this idempotent: the second tap, the forwarded copy
        // and the mail-gateway prefetch all leave the first click's timestamp
        // exactly where it was.
        const { error } = await admin
          .from('notification_history')
          .update({ clicked_at: new Date().toISOString() })
          .eq('id', safeSendId)
          .is('clicked_at', null);

        if (error) {
          console.warn('[EngagementClick] Click attribution failed:', error.message);
        }
      }
    } catch (error) {
      console.warn(
        '[EngagementClick] Click attribution failed:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return appRedirect(deepLink);
});
