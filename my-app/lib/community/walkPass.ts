/**
 * The walk "pass" (design "Detail 1 — The pass", Oct 2026) — the decisions
 * behind what the walk detail screen says, kept pure so they can be pinned by
 * tests. The screen only draws them.
 */

export type WalkState = 'planned' | 'active' | 'completed' | 'cancelled';

/** The yellow eyebrow at the top of the pass. */
export function passEyebrow(input: {
  state: WalkState | null | undefined;
  isHost: boolean;
  /** My attendance status, or null when I am in the pack but not asked. */
  myStatus: string | null;
}): { text: string; live: boolean } {
  switch (input.state) {
    case 'active': return { text: 'WALKING NOW', live: true };
    case 'completed': return { text: 'WALK FINISHED', live: false };
    case 'cancelled': return { text: 'CALLED OFF', live: false };
    case 'planned':
      if (input.isHost) return { text: 'YOU’RE HOSTING', live: false };
      if (input.myStatus === 'coming' || input.myStatus === 'checked_in') return { text: 'YOU’RE GOING', live: false };
      if (input.myStatus === 'cant_make_it') return { text: 'YOU CAN’T MAKE THIS ONE', live: false };
      return { text: 'YOU ARE INVITED', live: false };
    default: return { text: '', live: false };
  }
}

/**
 * The big time and the date line under it, split the way the pass sets them:
 * "07:00" large, "AM" small beside it, "WEDNESDAY 7 OCTOBER" in caps below.
 * A 24-hour locale has no period, and gets none.
 */
export function passTime(
  iso: string | null | undefined,
  format: { time: (date: Date) => string; date: (date: Date) => string },
): { time: string; period: string; date: string } {
  if (!iso) return { time: 'TBC', period: '', date: 'DATE TO BE CONFIRMED' };
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { time: 'TBC', period: '', date: 'DATE TO BE CONFIRMED' };
  const full = format.time(date).trim();
  // "07:00 AM", "07:00 am", "07:00 a.m." — with a space, a no-break space or a
  // narrow no-break space (newer ICU) before the period.
  const match = full.match(/^(.*?)[\s  ]*([AaPp]\.?\s?[Mm]\.?)$/);
  return {
    time: match ? match[1] : full,
    period: match ? match[2].toUpperCase().replace(/\s/g, '') : '',
    date: format.date(date).replace(/,/g, '').toUpperCase(),
  };
}

export type RosterRing = 'host' | 'decide' | 'coming' | 'walking' | 'finished' | 'asked' | 'cant';

/** One face in the "Who is walking" row: its ring and the caps word under it. */
export function rosterBadge(input: {
  status: string;
  isOrganizer: boolean;
  isMe: boolean;
  walkState: WalkState | null | undefined;
}): { ring: RosterRing; label: string } {
  if (input.isOrganizer) return { ring: 'host', label: 'HOST' };
  switch (input.status) {
    case 'coming':
    case 'checked_in': return { ring: 'coming', label: 'COMING' };
    case 'walking': return { ring: 'walking', label: 'WALKING' };
    case 'finished': return { ring: 'finished', label: 'DONE' };
    case 'cant_make_it': return { ring: 'cant', label: 'CAN’T' };
    default:
      // My own unanswered seat is the one decision on the screen that is mine.
      return input.isMe && input.walkState === 'planned'
        ? { ring: 'decide', label: 'DECIDE' }
        : { ring: 'asked', label: 'ASKED' };
  }
}

/** "0.8 km from you" / "350 m from you". Straight-line, so never over-precise. */
export function distanceFromYou(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '';
  if (meters < 1000) return `${Math.max(50, Math.round(meters / 50) * 50)} m from you`;
  if (meters < 10_000) return `${(meters / 1000).toFixed(1)} km from you`;
  return `${Math.round(meters / 1000)} km from you`;
}

/** The walk a new member answers next: running beats planned; then the soonest dated, then undated. */
export function pickNextOpenWalk(walks: readonly { id: string; state: string; scheduled_for: string | null }[]): string | null {
  const active = walks.find(walk => walk.state === 'active');
  if (active) return active.id;
  const at = (walk: { scheduled_for: string | null }) => {
    const ms = walk.scheduled_for ? Date.parse(walk.scheduled_for) : NaN;
    return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
  };
  const planned = walks.filter(walk => walk.state === 'planned').sort((a, b) => at(a) - at(b));
  return planned[0]?.id ?? null;
}
