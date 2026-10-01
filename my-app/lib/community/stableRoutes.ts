/**
 * Keep map routes the SAME objects when a reload hands back the same lines.
 *
 * The walk memory reloads while it settles (every few seconds) and on every
 * focus. Each load builds new arrays for routes that have not changed, which
 * gave the map a new `routes` prop and new polyline objects every time — the
 * native lines were re-sent although nothing on them moved (perf audit E3,
 * 2026-10-01).
 *
 * `reuseRoutes` compares by content: the id, colour, dash and every point.
 * An unchanged route comes back as the previous object; if nothing changed at
 * all, the previous ARRAY comes back, so a `useMemo` depending on it holds.
 * Comparison is exact, never sampled, so a moved point is never hidden.
 */

export interface RoutePoint {
  lat: number;
  lng: number;
}

export interface RouteLike {
  id: string;
  path: readonly RoutePoint[];
  color: string;
  dashed: boolean;
}

function samePath(a: readonly RoutePoint[], b: readonly RoutePoint[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].lat !== b[i].lat || a[i].lng !== b[i].lng) return false;
  }
  return true;
}

export function sameRoute(a: RouteLike, b: RouteLike): boolean {
  return a.id === b.id && a.color === b.color && a.dashed === b.dashed && samePath(a.path, b.path);
}

export function reuseRoutes<T extends RouteLike>(next: readonly T[], previous: readonly T[] | null): T[] {
  if (!previous) return [...next];
  const byId = new Map<string, T>();
  for (const route of previous) byId.set(route.id, route);

  let allReused = next.length === previous.length;
  const out = next.map((route, index) => {
    const held = byId.get(route.id);
    if (held && sameRoute(held, route)) {
      if (previous[index] !== held) allReused = false;
      return held;
    }
    allReused = false;
    return route;
  });
  return allReused ? (previous as T[]) : out;
}
