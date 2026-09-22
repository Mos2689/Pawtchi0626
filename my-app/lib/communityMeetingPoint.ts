/**
 * A Trail's meeting point — the words and the place, kept together.
 *
 * ── Why both, and why the words are not optional ────────────────────────────
 *
 * This used to be a text field and a guess. Someone typed "Centennial Park, by
 * the gates", and afterwards the app quietly asked the OS geocoder what that
 * might mean. When the guess worked the card got a map; when it did not,
 * nothing said so. Two people could plan to meet at the same park from opposite
 * entrances and the app would show one pin, or none, and never admit which.
 *
 * So the coordinate is now chosen, not inferred. But the words stay, because a
 * coordinate is not a meeting point: real ones are "by the gates", "the bench
 * under the big tree", "the second car park". A pin says where to stand; the
 * label says how to find each other once you are both there, and dropping it to
 * store a tidier lat/lng would lose the half people actually read.
 *
 * ── Unpinned is still valid ─────────────────────────────────────────────────
 *
 * `lat`/`lng` are nullable and must stay that way. Every walk planned before
 * this existed has a label and no coordinate, and a walk is not broken for
 * being vague about where it starts. Surfaces read `isPinned` and show what
 * they actually have rather than pretending.
 */

export interface MeetingPoint {
  /** What people read. Always required; this is the part that finds each other. */
  label: string;
  lat: number | null;
  lng: number | null;
}

export const EMPTY_MEETING_POINT: MeetingPoint = { label: '', lat: null, lng: null };

/** The shortest label worth saving, matching the old field's own rule. */
export const MIN_LABEL_LENGTH = 2;

/**
 * Whether this point has a real coordinate.
 *
 * Checked with `Number.isFinite` rather than a null test on purpose: geocoders
 * are a reliable source of `NaN`, and a NaN latitude passes `!= null`, survives
 * JSON, reaches the map and renders a pin in the Atlantic.
 */
export function isPinned(point: MeetingPoint): boolean {
  return (
    point.lat != null
    && point.lng != null
    && Number.isFinite(point.lat)
    && Number.isFinite(point.lng)
    // A coordinate outside these bounds is not a place, it is a bug that got
    // this far — most often lat and lng handed over the wrong way round.
    && Math.abs(point.lat) <= 90
    && Math.abs(point.lng) <= 180
  );
}

/** Whether this is enough to save. The words are the requirement, not the pin. */
export function isMeetingPointReady(point: MeetingPoint): boolean {
  return point.label.trim().length >= MIN_LABEL_LENGTH;
}

export type MeetingPointStatus = 'empty' | 'described' | 'pinned';

export function meetingPointStatus(point: MeetingPoint): MeetingPointStatus {
  if (!isMeetingPointReady(point)) return 'empty';
  return isPinned(point) ? 'pinned' : 'described';
}

/**
 * The coordinate, for someone who wants to see that there is one.
 *
 * Four decimals — about 11 metres — because more digits imply a precision a
 * dropped pin does not have, and fewer would not distinguish two entrances to
 * the same park.
 */
export function coordinateLabel(point: MeetingPoint): string | null {
  if (!isPinned(point)) return null;
  return `${point.lat!.toFixed(4)}, ${point.lng!.toFixed(4)}`;
}

/**
 * What the label field should say after the map has moved.
 *
 * Precedence, and the order is the whole rule: anything a person typed wins.
 * The reverse-geocoded name is only ever a suggestion for a field nobody has
 * touched — overwriting "by the gates" with "Anzac Parade" because the map
 * settled a few metres east would be the app correcting a person about their
 * own meeting point.
 */
export function suggestLabel(typed: string, resolved: string | null): string {
  const kept = typed.trim();
  if (kept.length > 0) return typed;
  return resolved ?? '';
}
