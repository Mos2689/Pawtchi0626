/**
 * "Up next" — one slot, four states.
 *
 * The Together screen used to show every trail as an equal card, which meant
 * the walk starting in twenty minutes looked exactly like the one somebody
 * might plan in a fortnight. This picks the ONE thing worth leading with and
 * says which of four situations you are in, because each wants a different
 * colour, a different verb, and a different amount of urgency.
 *
 *   live      a walk is running now                → open it
 *   planned   a walk has a date                    → the loud one, and the DEFAULT
 *   undated   a walk exists, nobody picked a day   → quiet, outlined
 *   empty     nothing at all                       → an invitation to host
 *
 * ── Why `planned` is loud even when it is a week away ───────────────────────
 *
 * This first shipped with yellow reserved for the hour before a walk, and
 * everything further out went quiet. That read as a screen with nothing on it:
 * an agreed walk on Wednesday is the single best thing this feature produces,
 * and showing it as a muted outline said the opposite. The eyebrow already
 * carries the distance — "STARTS IN 22 MIN" against "NEXT — WED, 11:43 PM" —
 * so urgency has a home without draining the colour out of a real plan.
 *
 * What the quiet card now means is narrower and more useful: there IS a walk,
 * and nobody has agreed a day for it. That is a genuinely different situation
 * with a genuinely different next action, and it deserved its own state more
 * than "Wednesday" did.
 *
 * Deliberately pure and deliberately separate from the component: which state
 * you are in is a claim about someone's day, and a claim is worth testing. The
 * card only paints it.
 */

import type { CommunityPack, CommunityWalk } from '../communityWalks';

export type UpNextState = 'live' | 'planned' | 'undated' | 'empty';

/**
 * How long after its start time a planned walk keeps leading the screen.
 *
 * A walk nobody pressed start on does not stop being the next thing that
 * happens — people are late, and a plan that vanishes at its own start time
 * takes the meeting point with it. It stays for three hours, then stops being
 * "up next" rather than claiming to be forever.
 */
export const OVERDUE_GRACE_MS = 3 * 60 * 60 * 1000;

export interface UpNextCandidate {
  pack: CommunityPack;
  walk: CommunityWalk;
}

export interface UpNext {
  state: UpNextState;
  candidate: UpNextCandidate | null;
}

function startsAt(walk: CommunityWalk): number | null {
  if (!walk.scheduled_for) return null;
  const ms = Date.parse(walk.scheduled_for);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The single walk this screen should lead with, and what kind of moment it is.
 *
 * Ordering, most urgent first:
 *
 *   1. Anything already running. A live walk outranks every plan — it is the
 *      only one you can still join.
 *   2. The soonest dated walk still ahead (or inside its grace period).
 *   3. An undated walk, which is a real plan with an unanswered question.
 *
 * An undated walk sorts LAST rather than first, for the same reason it does on
 * the trail screen: it is a genuine plan, but it cannot be the next one while a
 * dated walk exists.
 */
export function pickUpNext(packs: CommunityPack[], now: number): UpNext {
  const candidates: UpNextCandidate[] = [];
  for (const pack of packs) {
    const walk = pack.nextWalk;
    if (!walk) continue;
    if (walk.state !== 'planned' && walk.state !== 'active') continue;
    candidates.push({ pack, walk });
  }
  if (!candidates.length) return { state: 'empty', candidate: null };

  const live = candidates.filter(entry => entry.walk.state === 'active');
  if (live.length) {
    // Longest-running first: if two are somehow live, the one further along is
    // the one people are actually on.
    const sorted = [...live].sort((a, b) => {
      const aAt = Date.parse(a.walk.started_at ?? '') || 0;
      const bAt = Date.parse(b.walk.started_at ?? '') || 0;
      return aAt - bAt;
    });
    return { state: 'live', candidate: sorted[0] };
  }

  const dated = candidates
    .map(entry => ({ entry, at: startsAt(entry.walk) }))
    .filter((row): row is { entry: UpNextCandidate; at: number } => row.at !== null)
    .filter(row => row.at + OVERDUE_GRACE_MS > now)
    .sort((a, b) => a.at - b.at);

  if (dated.length) return { state: 'planned', candidate: dated[0].entry };

  const undated = candidates.find(entry => !entry.walk.scheduled_for);
  if (undated) return { state: 'undated', candidate: undated };

  // Every dated walk is long past and none is undated: nothing is coming.
  return { state: 'empty', candidate: null };
}

/**
 * The eyebrow above the title — the one line that carries the urgency.
 *
 * Minutes up to an hour, then hours, then the weekday. Never a bare timestamp:
 * "STARTS IN 22 MIN" is a different sentence from "SUN 7:15 AM", and which one
 * you need depends entirely on how close it is.
 */
export function upNextEyebrow(up: UpNext, now: number): string {
  if (!up.candidate) return 'NOTHING PLANNED';
  const { walk } = up.candidate;

  if (up.state === 'live') {
    const since = walk.started_at ? Date.parse(walk.started_at) : NaN;
    if (!Number.isFinite(since)) return 'WALKING NOW';
    const minutes = Math.max(0, Math.floor((now - since) / 60_000));
    return minutes < 1 ? 'LIVE — JUST STARTED' : `LIVE — ${minutes} MIN IN`;
  }

  const at = startsAt(walk);
  if (at === null) return 'DATE TO BE CONFIRMED';

  const delta = at - now;
  if (delta <= 0) return 'STARTING NOW';
  const minutes = Math.round(delta / 60_000);
  if (minutes < 60) return `STARTS IN ${minutes} MIN`;
  const hours = Math.round(delta / 3_600_000);
  if (hours < 24) return `STARTS IN ${hours} ${hours === 1 ? 'HOUR' : 'HOURS'}`;
  return `NEXT — ${new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(at)).toUpperCase()}`;
}

/**
 * "Mira hosts · Riverside Park", or as much of it as is actually known.
 *
 * Both halves are optional and the separator only appears between two real
 * things — a line reading " · Riverside Park" is how a missing name announces
 * itself as a bug.
 */
export function upNextSubtitle(
  walk: CommunityWalk,
  hostName: string | null,
  viewerIsHost: boolean,
): string {
  const who = viewerIsHost ? 'You host' : hostName ? `${hostName} hosts` : null;
  const where = walk.meeting_label?.trim() || null;
  return [who, where].filter(Boolean).join(' · ');
}
