/**
 * The emailed-CTA link contract: destination key → click URL → deep link.
 *
 * ── What was broken ─────────────────────────────────────────────────────────
 *
 * Every email CTA pointed at `https://pawtchi.com/app/<slug>`. That URL was
 * only ever going to open the app through a Universal Link / App Link, and:
 *
 *   - iOS never had the entitlement. `app.json` carries the associated domains
 *     under the inert key `__associatedDomains_temp`, so no released iOS build
 *     has ever claimed `pawtchi.com`.
 *   - The website has no `/app/*` route. `pawtchi-website/src/main.jsx` lists
 *     every path it serves and `/app/...` is not among them, so vercel.json
 *     rewrites it to index.html and React Router renders nothing.
 *
 * So the tap opened a browser on a blank page. Not a rendering bug — there was
 * no destination at either end.
 *
 * ── What replaces it ────────────────────────────────────────────────────────
 *
 * The email links to an https endpoint that answers 302 with a
 * `pawtchi://` deep link in `Location`. The email still contains an ordinary
 * https URL, which is the only kind a mail client will reliably render and not
 * strip; the OS does the app hand-off from the redirect.
 *
 * This module is the single definition of that hop, imported by both halves so
 * the sender and the redirector cannot disagree:
 *
 *   sender  →  clickUrl()     →  https://<ref>.supabase.co/functions/v1/engagement-click?s=…&t=…
 *   function →  deepLinkFor()  →  pawtchi:///(tabs)/health?engagement_send=…
 *
 * ── Why a key and never a URL ───────────────────────────────────────────────
 *
 * The click URL carries a destination *key* (`t=health`), not a redirect
 * target. A `?redirect=` parameter on a public endpoint is an open redirect,
 * and an open redirect on a supabase.co origin is a phishing primitive. Nothing
 * here can produce a destination that is not in `WEB_PATH_TO_ROUTE`.
 */

// Deliberately import-free. This module is the whole dependency of the public
// engagement-click function, which sits on the critical path of a tap — pulling
// the copy catalogue and the notification copy module into that cold start to
// read an eight-entry record would be a poor trade. `copy.ts` re-exports
// WEB_PATH_TO_ROUTE from here, so every existing reader is unchanged.

/**
 * Where each destination lands in the app.
 *
 * The contract in four places at once: the sender builds a click URL from it,
 * engagement-click redirects to it, the website slugs mirror it, and the app's
 * `routeForUrl()` returns it. Changing a route without changing all four
 * produces a link that silently opens the home tab.
 *
 * These are Expo Router paths, group segments and all. The group is not noise:
 * `app/(tabs)/health.tsx` and `app/health/index.tsx` BOTH claim the bare path
 * `/health` (both appear in `.expo/types/router.d.ts`), so `/(tabs)/health` is
 * the only spelling that names the health tab unambiguously.
 */
export const WEB_PATH_TO_ROUTE: Record<string, string> = {
  health: '/(tabs)/health',
  meal: '/(tabs)/meal',
  home: '/(tabs)',
  walks: '/walk-gallery',
  letters: '/letter',
  // The support thread. Reached only by the reply fallback, which always
  // carries a ticket id — landing on the hub would make somebody hunt for the
  // answer they were just told had arrived.
  support: '/support',
  activity: '/(tabs)/activity',
  profile: '/(tabs)/profile',
};

/**
 * The app's custom URL scheme, from `app.json`.
 *
 * Registered natively in every released build: `android/app/src/main/
 * AndroidManifest.xml` declares `<data android:scheme="pawtchi"/>`, and Expo
 * writes the matching `CFBundleURLTypes` entry from `expo.scheme` on prebuild.
 * Changing this string would need a new build of both apps to reach anyone.
 */
export const APP_SCHEME = 'pawtchi';

/**
 * Every destination an email CTA may name. Exactly the keys of
 * `WEB_PATH_TO_ROUTE` — the allowlist and the route table are the same thing,
 * so a target can never exist without a route or vice versa.
 */
export type CtaTarget =
  | 'home'
  | 'health'
  | 'meal'
  | 'activity'
  | 'profile'
  | 'walks'
  | 'letters'
  | 'support';

export const CTA_TARGETS: readonly CtaTarget[] = [
  'home',
  'health',
  'meal',
  'activity',
  'profile',
  'walks',
  'letters',
  'support',
] as const;

/**
 * Where an unrecognised or missing target lands.
 *
 * Home rather than a 400. Somebody tapped a button in an email we sent them;
 * the worst outcome we may hand back for a typo of our own making is the app
 * opening on the wrong screen, never an error page in a browser.
 */
export const CTA_DEFAULT_TARGET: CtaTarget = 'home';

export function isCtaTarget(value: unknown): value is CtaTarget {
  return typeof value === 'string' && (CTA_TARGETS as readonly string[]).includes(value);
}

/**
 * The two destinations that mean nothing without an identifier. A reply
 * notification that lands on a list is a miss — the owner was told an answer
 * had arrived, so the tap owes them that answer and not a search for it.
 *
 * Every other target ignores a resource id rather than appending it, because
 * `/(tabs)/health/<uuid>` is not a route and would strand the tap.
 */
const TARGETS_TAKING_RESOURCE: readonly CtaTarget[] = ['letters', 'support'] as const;

/**
 * The in-app route for a destination, with the id appended where one applies.
 *
 * Returns an Expo Router path. Expo Router resolves `/(tabs)/health` through
 * the same `getStateFromPath` that `router.push()` uses, so the string is
 * understood identically whether the OS hands it over as a URL or the app
 * pushes it after reading one.
 */
export function routeForTarget(target: CtaTarget, resourceId?: string | null): string {
  const route = WEB_PATH_TO_ROUTE[target];
  if (resourceId && TARGETS_TAKING_RESOURCE.includes(target)) {
    return `${route}/${resourceId}`;
  }
  return route;
}

/**
 * The deep link the click endpoint redirects to.
 *
 * Three slashes, always. `pawtchi:///(tabs)/health` parses to an empty host and
 * a real pathname; the two-slash form would read `(tabs)` as the hostname and
 * leave `/health` as the path, which resolves to a different screen or to
 * nothing depending on the parser.
 *
 * `engagement_send` rides along so the app can attribute the session to the
 * email that started it. It is a ledger row id and carries no authority.
 */
export function deepLinkFor(
  target: CtaTarget,
  resourceId?: string | null,
  sendId?: string | null,
): string {
  const route = routeForTarget(target, resourceId);
  const params = new URLSearchParams();
  if (sendId) params.set('engagement_send', sendId);
  const query = params.toString();
  // `route` already starts with "/", so this is the triple-slash form.
  return `${APP_SCHEME}://${route}${query ? `?${query}` : ''}`;
}

/** What the sender needs to build a click URL for one specific email. */
export interface ClickConfig {
  /**
   * Public functions origin, e.g. `https://<ref>.supabase.co/functions/v1`.
   * Absolute because there is no document origin in a mail client.
   */
  functionsBase: string;
  /** The `notification_history` row this email is being sent as. */
  sendId: string;
}

/**
 * The https URL that goes in the email — HTML and plain text alike.
 *
 * Never a custom scheme. Gmail and Outlook strip or disable `pawtchi://` in
 * message bodies, which is the reason this indirection exists at all.
 */
export function clickUrl(
  config: ClickConfig,
  target: CtaTarget,
  resourceId?: string | null,
): string {
  const params = new URLSearchParams({ s: config.sendId, t: target });
  if (resourceId) params.set('r', resourceId);
  return `${config.functionsBase.replace(/\/+$/, '')}/engagement-click?${params.toString()}`;
}

/**
 * Reads a composition's `/app/<slug>[/<id>]` CTA path back into a destination.
 *
 * The compositions keep writing that path — it is the destination key they have
 * always written, and it stays the shared spelling with the website and with
 * the app's https handler. This is what lets the whole change land in one place
 * (`href()` in template.ts) instead of in every campaign.
 *
 * Returns null for anything that is not an allowlisted `/app/` path, so an
 * unrecognised CTA falls back to the plain website URL rather than silently
 * becoming a click link to somewhere else.
 */
export function ctaTargetForPath(
  path: string,
): { target: CtaTarget; resourceId: string | null } | null {
  // Query and fragment are not part of the destination key.
  const clean = path.split(/[?#]/)[0];
  const segments = clean.split('/').filter(Boolean);
  if (segments[0] !== 'app') return null;

  const slug = segments[1];
  if (!isCtaTarget(slug)) return null;

  const resourceId = segments[2] ?? null;
  return { target: slug, resourceId };
}
