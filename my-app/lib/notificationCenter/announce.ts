/**
 * Read state and the arrival pill's show/hide rule.
 *
 * Both live here rather than in the store so they can be tested without
 * standing up Supabase — the store imports this file, not the other way round.
 *
 * ── Why announcing is not reading ───────────────────────────────────────────
 *
 * They are two different claims and the app makes them at different moments.
 * Read is about the item: it syncs to the server, survives a reinstall and
 * reaches the owner's other devices. Announced is about one glance at the
 * header: "the bell has already told you these exist". Tapping the bell must
 * collapse the pill without asserting the owner read anything, so the two lists
 * are kept apart.
 */

import type { InboxItem } from './types';

/**
 * Read, from whichever source knows about it.
 *
 * Locally derived items only ever have the AsyncStorage list. Pushes also carry
 * the server's `read_at`, and consulting it is what makes the center survive a
 * reinstall or a second device: without it, a notification read on a phone
 * would come back unread on a tablet and every historical push would arrive
 * bold on a fresh install.
 */
export function isItemRead(item: InboxItem, readIds: ReadonlySet<string>): boolean {
  return readIds.has(item.id) || item.meta?.server_read === true;
}

/**
 * True when something unread has not yet had its turn in the arrival pill.
 *
 * Identity-based, and that is the whole design. Counting looks equivalent and
 * is not: read one of three items and gain a new one, and the count returns to
 * three without ever exceeding its previous high — so a count-watching pill
 * would stay silent about a genuinely new arrival. Ids cannot be fooled that
 * way, and they also survive the feed being rebuilt and re-sorted, which the
 * derived sources do constantly.
 */
export function hasNewAnnouncement(
  items: readonly InboxItem[],
  readIds: readonly string[],
  announcedIds: readonly string[],
): boolean {
  const read = new Set(readIds);
  const announced = new Set(announcedIds);
  return items.some(item => !isItemRead(item, read) && !announced.has(item.id));
}
