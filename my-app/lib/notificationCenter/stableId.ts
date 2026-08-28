/**
 * Item identity.
 *
 * The center recomputes its derived items on every `refreshToday`, every focus
 * change and every weight write. If an item's id moved with the data behind it,
 * "read" would last until the next store update and the badge would resurrect
 * itself all day. So ids are built from the *rule* that fired, not from the
 * numbers that made it fire.
 *
 * This generalises `nudgeKey()` from store/usePetContextStore.ts, which already
 * preferred `actionType` over the title for exactly this reason: the title
 * carries interpolated stats ("14 days since the last weigh-in") and changes
 * under you; the action does not.
 *
 * Scope is the second half. Most derived items are a statement about *today* —
 * "meals missing" read this morning should come back tomorrow. Passing the
 * local YMD as the scope gives that for free. Items that are not day-scoped
 * (a clinical condition, a real push) pass `'persistent'` or the row id.
 */

import { getLocalYMD } from '../dateUtils';
import type { InboxSource } from './types';

/** Scope for something that should return each new local day. */
export function dayScope(now: Date = new Date()): string {
  return getLocalYMD(now);
}

/** Scope for something that stays one item until the condition itself resolves. */
export const PERSISTENT_SCOPE = 'persistent';

/**
 * Builds an item id.
 *
 * Shape is `source:key:scope`, which is greppable in analytics and readable in
 * a debugger — worth more here than the few bytes a hash would save.
 *
 * `key` must identify the RULE (`weigh_in_due`, `severe_obesity`), never the
 * rendered copy. Colons in either part are collapsed so the shape stays
 * parseable when a caller passes an id that already contains one.
 */
export function stableId(source: InboxSource, key: string, scope: string): string {
  return [source, sanitise(key), sanitise(scope)].join(':');
}

function sanitise(part: string): string {
  return part.trim().replace(/:/g, '_') || 'unknown';
}

/** The scope segment of an id, or null if it is not one of ours. */
export function scopeOf(id: string): string | null {
  const parts = id.split(':');
  return parts.length >= 3 ? parts.slice(2).join(':') : null;
}

/**
 * True when an id belongs to a local day that has passed.
 *
 * The store uses this to sweep yesterday's read ids rather than letting the
 * list grow forever — the same job `getAllowedNudge()` did by storing a single
 * date alongside the dismissed keys, but per-item so a mixed-scope feed works.
 */
export function isStaleDayScoped(id: string, now: Date = new Date()): boolean {
  const scope = scopeOf(id);
  if (!scope || scope === PERSISTENT_SCOPE) return false;
  // Only YYYY-MM-DD scopes are day-scoped; anything else is an entity id.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scope)) return false;
  return scope < dayScope(now);
}
