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
