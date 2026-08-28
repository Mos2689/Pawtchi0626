/**
 * walkGallery — groups the walk archive by where each walk started.
 *
 * The gallery used to be one undifferentiated grid of route tiles ordered by
 * date. That works for the last few walks and stops working at fifty: every
 * tile is a small grey squiggle, and "the one along the beach" is impossible to
 * find by eye. Place is the thing people actually remember about a walk.
 *
 * Grouping by START label specifically, not end or farthest. A walk is
 * remembered by where you set off from — the door you left, the car park you
 * parked in — and it is also the label most reliably present, since reverse
 * geocoding the first GPS fix succeeds far more often than the last (walks end
 * indoors, mid-tunnel, or with the phone already pocketed).
 *
 * Pure: no React, no queries. The screen supplies rows and renders the result.
 */

/** The subset of a walk row this module needs. */
export interface GalleryWalkSource {
  id: string;
  started_at: string;
  distance_m: number;
  start_label: string | null;
  end_label: string | null;
  farthest_label: string | null;
}

/**
 * Generic over the row type so the caller's own shape survives grouping.
 *
 * The gallery screen needs `route` on each walk to draw its tile, and the whole
 * row to open the share sheet. Narrowing to `GalleryWalkSource` here would
 * force a cast back at every use site.
 */
export interface WalkPlaceGroup<T extends GalleryWalkSource = GalleryWalkSource> {
  /** Case-folded label, or UNPLACED_KEY. Stable across renders. */
  key: string;
  /** What to show. Original casing of the first walk seen for this place. */
  label: string;
  /** Newest first, matching every other walk list in the app. */
  walks: T[];
  /** ISO of the most recent walk here — what the groups are ordered by. */
  lastWalkAt: string;
  totalKm: number;
}

/**
 * The bucket for walks whose start could not be reverse-geocoded.
 *
 * They are kept rather than dropped: a walk with no label is still a walk the
 * owner took, and hiding it would make the gallery quietly disagree with the
 * totals on the same screen.
 */
export const UNPLACED_KEY = '__unplaced__';
export const UNPLACED_LABEL = 'Somewhere else';

function cleanLabel(label: string | null | undefined): string | null {
  const t = (label ?? '').trim();
  return t.length > 0 ? t : null;
}

/**
 * Which label names this walk's place.
 *
 * Falls through start → farthest → end. Farthest before end because a loop
 * walk returns home, so its end label is the same as its start and adds
 * nothing; the farthest point is the part of that walk worth naming.
 */
export function placeLabelOf(walk: GalleryWalkSource): string | null {
  return (
    cleanLabel(walk.start_label) ??
    cleanLabel(walk.farthest_label) ??
    cleanLabel(walk.end_label)
  );
}

/**
 * Group walks by place, newest group first.
 *
 * Ordered by recency rather than by visit count. Frequency would surface the
 * regular haunt first and tells a nicer story, but the gallery's job is
 * retrieval — someone is usually looking for a specific recent walk, and every
 * other list in the app is newest-first. The visit count is on the header, so
 * the "we come here a lot" signal is not lost.
 *
 * `Somewhere else` always sorts last regardless of recency: it is a fallback
 * bucket, not a place, and letting it lead would put the least informative
 * group at the top.
 */
export function groupWalksByPlace<T extends GalleryWalkSource>(
  walks: readonly T[],
): WalkPlaceGroup<T>[] {
  const byKey = new Map<string, WalkPlaceGroup<T>>();

  for (const walk of walks) {
    const label = placeLabelOf(walk);
    const key = label ? label.toLowerCase() : UNPLACED_KEY;

    const existing = byKey.get(key);
    if (existing) {
      existing.walks.push(walk);
      existing.totalKm += (Number(walk.distance_m) || 0) / 1000;
      if (walk.started_at > existing.lastWalkAt) existing.lastWalkAt = walk.started_at;
      continue;
    }

    byKey.set(key, {
      key,
      label: label ?? UNPLACED_LABEL,
      walks: [walk],
      lastWalkAt: walk.started_at,
      totalKm: (Number(walk.distance_m) || 0) / 1000,
    });
  }

  const groups = [...byKey.values()];

  for (const group of groups) {
    group.walks.sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
  }

  groups.sort((a, b) => {
    if (a.key === UNPLACED_KEY) return 1;
    if (b.key === UNPLACED_KEY) return -1;
    if (a.lastWalkAt === b.lastWalkAt) return a.key < b.key ? -1 : 1;
    return a.lastWalkAt < b.lastWalkAt ? 1 : -1;
  });

  return groups;
}

/**
 * Split a group's walks into fixed-width rows.
 *
 * SectionList cannot do `numColumns`, so a grid inside sections has to be built
 * from rows of N. Keeping it here means the screen renders a row rather than
 * doing arithmetic mid-JSX, and the ragged last row is testable.
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) return items.length > 0 ? [[...items]] : [];
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    rows.push(items.slice(i, i + size));
  }
  return rows;
}

/** "12 walks · 34.2 km" — the line under a place name. */
export function groupSummary(group: WalkPlaceGroup<GalleryWalkSource>): string {
  const walks = `${group.walks.length} ${group.walks.length === 1 ? 'walk' : 'walks'}`;
  const km = group.totalKm >= 0.1 ? ` · ${group.totalKm.toFixed(1)} km` : '';
  return `${walks}${km}`;
}
