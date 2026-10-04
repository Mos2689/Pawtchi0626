/**
 * The order colours are dealt in on the live map — fixed for the whole walk.
 *
 * The live screen used to colour walkers by their index in the positions list,
 * and that list arrives sorted by `recorded_at` descending. So whoever pinged
 * most recently was always first: with two people walking, the latest ping
 * alternated between them and their lines and markers swapped colours every
 * few seconds (found during the perf audit, 2026-10-01).
 *
 * Colour now follows WHO, in an order that does not move:
 *   1. the viewer — their own line is the one they are watching;
 *   2. everyone on the walk, in the order they joined it (ties by user id);
 *   3. anyone else with a position, by user id.
 * Dealing from the whole roster, rather than from whoever is visible right now,
 * means somebody appearing or going quiet never recolours anyone else.
 */

export interface RosterRow {
  user_id: string;
  joined_at?: string | null;
}

function joinedKey(row: RosterRow): number {
  const at = row.joined_at ? Date.parse(row.joined_at) : NaN;
  return Number.isFinite(at) ? at : Number.POSITIVE_INFINITY;
}

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function walkerColourOrder(
  viewerId: string | null | undefined,
  roster: readonly RosterRow[],
  present: readonly string[],
): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  const add = (id: string | null | undefined) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    order.push(id);
  };

  add(viewerId);
  [...roster]
    .sort((a, b) => joinedKey(a) - joinedKey(b) || byId(a.user_id, b.user_id))
    .forEach(row => add(row.user_id));
  [...present].sort(byId).forEach(add);
  return order;
}

// ── Live positions from realtime events (perf-live-deltas) ───────────────────

/**
 * One walker's latest position, as `community_live_locations` stores it.
 * Structural, so this file stays free of the data layer.
 */
export interface LivePartyRow {
  walk_id: string;
  user_id: string;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  path: { lat: number; lng: number }[];
  recorded_at: string;
}

/** The parts of a Supabase realtime payload this needs. */
export interface LivePartyChange {
  eventType: string;
  new?: Partial<LivePartyRow> | Record<string, unknown> | null;
  old?: Partial<LivePartyRow> | Record<string, unknown> | null;
}

const recordedMs = (value: unknown): number => {
  const at = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? at : Number.NEGATIVE_INFINITY;
};

/**
 * Apply one realtime position event to the walkers on the map.
 *
 * ── Why (4 Oct 2026) ────────────────────────────────────────────────────────
 *
 * Every ping from every phone used to trigger a full re-read of everybody's
 * position, path included — 167 reads during one 3-person walk, on a server
 * that was already stalling. The event already carries the row (Realtime
 * applies the same read policy as the table), so it is applied directly and
 * the full read is kept for subscribe, foreground and a once-a-minute check.
 *
 * ── Rules ───────────────────────────────────────────────────────────────────
 *
 *   - Insert/update: upsert by `user_id`, newest first like `listLiveParties`.
 *   - An event older than the position already held is ignored, so a late
 *     event can never move a dot backwards.
 *   - A missing `path` keeps the one held: Postgres leaves large unchanged
 *     values out of the change stream.
 *   - Delete removes the walker (`old` carries the key).
 *   - Nothing changed → the SAME array comes back, and walkers that did not
 *     move keep their object, so the map does not rebuild their lines.
 */
export function applyLivePartyChange<T extends LivePartyRow>(
  parties: T[],
  change: LivePartyChange,
): T[] {
  if (change.eventType === 'DELETE') {
    const userId = (change.old as Partial<LivePartyRow> | null | undefined)?.user_id;
    if (typeof userId !== 'string' || !parties.some(party => party.user_id === userId)) return parties;
    return parties.filter(party => party.user_id !== userId);
  }
  if (change.eventType !== 'INSERT' && change.eventType !== 'UPDATE') return parties;

  const row = (change.new ?? {}) as Partial<LivePartyRow>;
  if (typeof row.user_id !== 'string' || typeof row.lat !== 'number' || typeof row.lng !== 'number') return parties;

  const held = parties.find(party => party.user_id === row.user_id);
  if (held && recordedMs(row.recorded_at) <= recordedMs(held.recorded_at)) return parties;

  const next = {
    ...(held ?? {}),
    ...row,
    path: Array.isArray(row.path) ? row.path : held?.path ?? [],
  } as T;
  return [...parties.filter(party => party.user_id !== row.user_id), next]
    .sort((a, b) => recordedMs(b.recorded_at) - recordedMs(a.recorded_at));
}

/** Full position re-read while live events are applied directly. */
export const LIVE_RECONCILE_MS = 60_000;

/** How often TrailRecording's close check runs while realtime is connected. */
export const CLOSE_CHECK_CONNECTED_MS = 30_000;

/**
 * Whether TrailRecording's poll tick should read the walk's state now. With
 * perf-live-deltas on and the realtime channel connected, the close event
 * arrives on its own and the read is only a backstop, every 30 s instead of
 * every 10. Without either, every tick reads, as before.
 */
export function closeCheckDue(input: {
  lighter: boolean;
  subscribed: boolean;
  lastCheckAt: number;
  now: number;
}): boolean {
  if (!input.lighter || !input.subscribed) return true;
  return input.now - input.lastCheckAt >= CLOSE_CHECK_CONNECTED_MS;
}
