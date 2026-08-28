/**
 * cluster — collapse overlapping pins in SCREEN space, not geographic space.
 *
 * The distinction matters. Clustering by metres would need a different
 * threshold at every zoom level and would still be wrong, because what makes
 * two pins unreadable is not how far apart they are on the ground — it is how
 * far apart they are in pixels. Two vets 40 m apart overlap at neighbourhood
 * zoom and are comfortably separate at street zoom, and a screen-space grid
 * gets both right with one constant.
 *
 * This works because Home already projects its own markers: `projectPoint`
 * (lib/walk/mapCamera.ts) turns a coordinate into an x/y against the exact same
 * camera the basemap is using, so the clustering sees precisely what the eye
 * will see.
 *
 * Grid bucketing rather than true distance clustering. It is O(n) instead of
 * O(n²), deterministic, and its one artefact — two pins either side of a cell
 * boundary staying separate — is invisible at this scale.
 */

import type { ScreenPoint } from '../walk/mapCamera';

/**
 * Cell size in px. Pins are 18-22 px, so 44 guarantees two clustered pins would
 * genuinely have overlapped, and leaves room for the label pill.
 */
export const CLUSTER_CELL_PX = 44;

export interface Clusterable {
  id: string;
  at: ScreenPoint;
}

export interface Cluster<T extends Clusterable> {
  /** Stable across renders: the lead member's id, not the grid position. */
  id: string;
  at: ScreenPoint;
  /** Every member, lead first. `length === 1` means an ordinary pin. */
  members: T[];
}

/**
 * Bucket by grid cell, then place each cluster at its members' centroid.
 *
 * The centroid rather than the cell centre so a two-pin cluster sits between
 * the two places it represents instead of snapping to an arbitrary grid point.
 *
 * Input order decides the lead member, so callers should pass their ranked
 * order — the closest/most relevant spot then names the cluster and is what a
 * tap selects first.
 */
export function clusterByScreen<T extends Clusterable>(
  items: readonly T[],
  cellPx: number = CLUSTER_CELL_PX,
): Cluster<T>[] {
  const buckets = new Map<string, T[]>();
  const order: string[] = [];

  for (const item of items) {
    const key = `${Math.floor(item.at.x / cellPx)}:${Math.floor(item.at.y / cellPx)}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      buckets.set(key, [item]);
      // Track first-seen order so the output follows the input's ranking
      // rather than Map iteration order over string keys.
      order.push(key);
    }
  }

  return order.map(key => {
    const members = buckets.get(key)!;
    const sumX = members.reduce((s, m) => s + m.at.x, 0);
    const sumY = members.reduce((s, m) => s + m.at.y, 0);
    return {
      id: members[0].id,
      at: { x: sumX / members.length, y: sumY / members.length },
      members,
    };
  });
}

/** Whether a cluster should render as a count bubble rather than a single pin. */
export function isGrouped<T extends Clusterable>(cluster: Cluster<T>): boolean {
  return cluster.members.length > 1;
}
