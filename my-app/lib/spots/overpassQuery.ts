/**
 * overpassQuery — builds the Overpass QL sent upstream.
 *
 * Shared verbatim with the Edge Function (`supabase/functions/nearby-spots`)
 * rather than duplicated, so the query and the classifier can never disagree
 * about which tags matter. That drift is silent when it happens: you fetch a
 * category the classifier ignores, or classify one you never asked for.
 *
 * ── Safety, since this hits volunteer infrastructure ──
 * Every query is bounded three ways: an `around` filter (never an unbounded
 * area or bbox), a server-side element cap, and a hard `timeout`. There is no
 * code path here that can emit a query without all three. The Overpass usage
 * policy asks for exactly this, and a public instance will — rightly — start
 * refusing us if we take liberties.
 */

import { CATEGORY_RULES, queryableCategories, type TagClause } from './osmTags';
import type { SpotCategory } from './types';

/** Upstream timeout in SECONDS — Overpass's own units, inside its header. */
export const OVERPASS_TIMEOUT_S = 25;

/**
 * Ceiling on the whole response, summed from the per-category limits in
 * osmTags.ts. Exported for the tests and for reasoning about payload size; the
 * query itself is bounded per category, not by this number.
 */
export const OVERPASS_MAX_ELEMENTS = CATEGORY_RULES.filter(r =>
  queryableCategories().includes(r.category),
).reduce((sum, r) => sum + r.limit, 0);

/**
 * Default endpoint. Configurable rather than hard-coded at every call site so
 * we can move to a different mirror — or our own instance — without touching
 * feature code.
 */
export const DEFAULT_OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';

/**
 * Mirrors, tried in order.
 *
 * Overpass rate-limits by IP, and Edge Functions run from shared infrastructure
 * that a great many projects call from — so the main instance can refuse us for
 * reasons that have nothing to do with our own traffic. A single endpoint makes
 * that a hard outage for the whole feature.
 *
 * These are the public instances that publish an open usage policy. They are
 * independent deployments, so a refusal from one says nothing about the next.
 * Order is by capacity, main instance first.
 */
export const OVERPASS_ENDPOINTS = [
  DEFAULT_OVERPASS_ENDPOINT,
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
] as const;

/**
 * Statuses worth trying another mirror for.
 *
 * 429 and 504 are Overpass's normal load-shedding — the instance is busy, not
 * broken, and a sibling may well answer. 400 is OUR query being wrong, so
 * retrying it anywhere is pointless and just spends someone else's capacity.
 */
export function isRetriableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/**
 * A real, contactable User-Agent, which the OSM tile and Overpass policies both
 * require. An anonymous scraper is the thing they block.
 */
export const OVERPASS_USER_AGENT = 'Pawtchi/1.0 (+https://pawtchi.com; hello@pawtchi.com)';

/** `["k"="v"]` / `["k"]` / `["k"~"v"]`. */
function clauseToQl(c: TagClause): string {
  if (c.v === undefined) return `["${c.k}"]`;
  return c.regex ? `["${c.k}"~"${c.v}"]` : `["${c.k}"="${c.v}"]`;
}

/**
 * Build the query for one point and radius.
 *
 * `categories` defaults to the queryable set (i.e. trails excluded — see
 * SPOT_TRAILS_ENABLED). Passing an explicit list is for tests and for a future
 * "only refresh vets" path; it is intersected with the known rules, so an
 * unrecognised category can never widen the query.
 *
 * `out center tags` is the load-bearing part: `center` gives ways and relations
 * a single coordinate (see normalize.ts) and `tags` keeps full geometry out of
 * the response, which is most of the payload for a large park.
 */
export function buildOverpassQuery(
  lat: number,
  lng: number,
  radiusMeters: number,
  categories: SpotCategory[] = queryableCategories(),
): string {
  const wanted = new Set(categories);
  const radius = Math.round(radiusMeters);
  const blocks: string[] = [];

  // One union + one `out` PER CATEGORY, rather than one union for everything.
  //
  // Overpass evaluates statements in order and each `out` emits the current
  // result set, so this gives every category its own budget. A single global
  // union with one `out N` looked equivalent and was not: in central London the
  // drinking fountains alone filled the entire limit and silently truncated
  // every dog park and pet shop out of the response.
  for (const rule of CATEGORY_RULES) {
    if (!wanted.has(rule.category)) continue;
    const lines: string[] = [];
    for (const selector of rule.selectors) {
      const filters = selector.map(clauseToQl).join('');
      for (const element of rule.elements) {
        lines.push(`  ${element}${filters}(around:${radius},${lat},${lng});`);
      }
    }
    if (lines.length === 0) continue;
    blocks.push(['(', ...lines, ');', `out center tags ${rule.limit};`].join('\n'));
  }

  return [`[out:json][timeout:${OVERPASS_TIMEOUT_S}];`, ...blocks].join('\n');
}

/**
 * Coordinates are rounded to 4 dp (~11 m) before going upstream.
 *
 * They are already cell centres, so they identify a neighbourhood rather than a
 * person — but 14 decimal places in a third party's request log implies a
 * precision we have no reason to hand over, and it would also fragment their
 * cache. Four is more than enough to place a 5 km circle.
 */
export function roundForQuery(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}
