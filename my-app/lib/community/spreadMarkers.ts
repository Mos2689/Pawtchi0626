/**
 * Keep walkers' markers from stacking on top of each other.
 *
 * ── Why zoom cannot do this on its own ────────────────────────────────────
 *
 * The point of a shared walk is that people walk TOGETHER — a metre or two
 * apart. A marker is 50 px of avatar with a name label under it; at the live
 * map's closest framing a pixel is roughly a metre of ground, so one marker
 * covers the better part of a hundred metres. Two people walking side by side
 * land on top of each other at any zoom a street map can show, on both
 * platforms.
 *
 * Zooming handles the OTHER case — a pack that has spread out — and the live
 * screen already re-fits its camera around everyone as they move. This handles
 * what zoom structurally cannot: markers closer on screen than a marker is wide.
 *
 * ── What it does ──────────────────────────────────────────────────────────
 *
 * Markers within `minDistance` of each other (directly or through a chain) form
 * a group. Each group's members are placed evenly around the group's centre,
 * `minDistance` apart, so each face and label is readable. The true position is
 * returned alongside as `anchor`, so the screen can still mark where they
 * really are.
 *
 * Deterministic and stable: members are ordered by id, so the same group lays
 * out the same way on every refresh. Without that, positions arrive every few
 * seconds and people would visibly swap places each time.
 *
 * Pure: screen points in, screen points out. No map, no React.
 */

export interface MarkerPoint {
  id: string;
  x: number;
  y: number;
}

export interface SpreadMarker extends MarkerPoint {
  /** Where the person actually is. Equal to x/y when nothing was moved. */
  anchor: { x: number; y: number };
  /** True when this marker was moved off its real position. */
  displaced: boolean;
}

export function spreadMarkers(
  points: readonly MarkerPoint[],
  minDistance: number,
): SpreadMarker[] {
  const usable = points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!(minDistance > 0) || usable.length < 2) {
    return usable.map(p => ({ ...p, anchor: { x: p.x, y: p.y }, displaced: false }));
  }

  // Union-find over every close pair — single linkage, so A near B near C forms
  // one group even when A and C are far apart. Packs are small, so O(n²) is fine.
  const parent = usable.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < usable.length; i += 1) {
    for (let j = i + 1; j < usable.length; j += 1) {
      if (Math.hypot(usable[i].x - usable[j].x, usable[i].y - usable[j].y) < minDistance) {
        parent[find(i)] = find(j);
      }
    }
  }

  const groups = new Map<number, MarkerPoint[]>();
  usable.forEach((p, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), p]);
  });

  const placed = new Map<string, SpreadMarker>();
  for (const members of groups.values()) {
    if (members.length === 1) {
      const [p] = members;
      placed.set(p.id, { ...p, anchor: { x: p.x, y: p.y }, displaced: false });
      continue;
    }

    const ordered = [...members].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const cx = ordered.reduce((sum, p) => sum + p.x, 0) / ordered.length;
    const cy = ordered.reduce((sum, p) => sum + p.y, 0) / ordered.length;
    const n = ordered.length;

    // Neighbours on a regular n-gon are `minDistance` apart when the radius is
    // this — for two, that is simply half the distance either side of centre.
    const radius = minDistance / (2 * Math.sin(Math.PI / n));
    // Two walkers sit left and right of each other, which is how people walking
    // side by side actually look. Larger groups start from the top.
    const start = n === 2 ? Math.PI : -Math.PI / 2;

    ordered.forEach((p, k) => {
      const angle = start + (2 * Math.PI * k) / n;
      placed.set(p.id, {
        id: p.id,
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
        anchor: { x: p.x, y: p.y },
        displaced: true,
      });
    });
  }

  // Preserve the caller's order.
  return usable.map(p => placed.get(p.id)!);
}
