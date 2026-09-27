/**
 * liveCopy — every word the walk Live Activity can say, in one place.
 *
 * The Lock Screen card resolves its strings HERE, in TypeScript, and ships
 * finished text to Swift. The widget target authors no copy of its own, so a
 * wording change stays a one-file change and never needs a Swift edit — and the
 * live walk screen (`app/walk.tsx`) shares the status line, so the two surfaces
 * cannot describe the same walk differently.
 *
 * Two places where this deviates from the design handoff, both deliberate:
 *
 *   • The starting card's sub-line is "Finding GPS — hold on a moment", not the
 *     handoff's "Tracking starts when you move". Tracking has already started by
 *     then; what we are actually waiting for is a usable fix. The handoff line
 *     would tell the owner to start walking to make something happen, which is
 *     both untrue and the wrong instruction.
 *
 *   • The finished eyebrow only says SAVED when the walk really is saved. A walk
 *     finished offline sits in the sync queue, and the card must not promise a
 *     server write that has not happened. See `finishedEyebrow`.
 */

/** The live status line, shared with the walk screen's own status row. */
export const WALK_STATUS_COPY = {
  /** No accepted fix yet — the walk exists but has no shape. */
  acquiring: 'Finding GPS — hold on a moment',
  /** The session machine has auto-paused: a real, minutes-long sniff stop. */
  sniffing: 'Paused with the sniffs — resumes on the next step',
  /** The ordinary case, and the reassurance that matters most: it self-ends. */
  walking: 'Tracking — ends on its own at home',
  /** The Live Activity's last frame, when nothing stronger can be claimed. */
  finished: 'Walk finished',
} as const;

export type WalkStatusKey = keyof typeof WALK_STATUS_COPY;

/** The small uppercase label beside the live pulse. */
export const LIVE_EYEBROW = {
  starting: 'STARTING',
  walking: 'WALKING',
  /** Pawtchi's own addition to the handoff's three states: a dog nose-down is
   *  the thing this app notices that a step counter does not, and the card is
   *  the one surface where saying so costs nothing. */
  sniffing: 'SNIFFING',
} as const;

/**
 * How much of a pack's name the eyebrow can carry.
 *
 * The eyebrow is one short uppercase line beside a pulsing dot, and it already
 * holds the walk's state. A pack called "Thursday morning beach crew" would
 * push the state off the card on a Lock Screen, so the name is clipped here
 * rather than left to SwiftUI — a truncation the widget performs is one the
 * copy rules never saw.
 */
export const TRAIL_NAME_CAP = 18;

function clipPackName(packName: string): string {
  const name = packName.trim();
  if (name.length <= TRAIL_NAME_CAP) return name;
  // Trim back to a word boundary where there is one close enough, so the clip
  // reads as a shortened name rather than a broken one.
  const cut = name.slice(0, TRAIL_NAME_CAP);
  const space = cut.lastIndexOf(' ');
  return `${(space > TRAIL_NAME_CAP - 6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * The eyebrow, which on a Trail also has to say WHICH trail.
 *
 * The state stays first because it is the thing that changes — an owner
 * glancing at the card is checking whether the dog is moving, not re-reading
 * the pack's name. The pack rides behind it as context.
 *
 * A solo walk is unchanged, and that is the point: absence of a pack name is
 * how the two kinds of walk stay visibly different on the Lock Screen.
 */
export function liveEyebrow(
  state: keyof typeof LIVE_EYEBROW,
  packName?: string | null,
): string {
  const base = LIVE_EYEBROW[state];
  const pack = packName?.trim();
  return pack ? `${base} · ${clipPackName(pack).toUpperCase()}` : base;
}

/** The geofence pill. Always true of a tracked walk — auto-stop is armed from
 *  the first fix — so it is a statement of fact, not a prediction. */
export const ENDS_AT_HOME = 'Ends at home';

/** Replaces the stats shelf when GPS has dropped out mid-walk. */
export const WAITING_FOR_SIGNAL = 'Waiting for signal';

/** The finished card's call to action. */
export const SEE_THE_MAP = 'See the map';

/**
 * The same CTA when the walk was a Trail.
 *
 * Different words because it opens a different thing: a solo walk's wrap-up
 * opens that walk's own map, a Trail's opens the shared memory with everyone
 * else's traces on it. "See the map" would undersell what is waiting there.
 */
export const SEE_THE_TRAIL = 'See the meetup';

/** "Momo's walk" — the starting card's title. */
export function startingTitle(petName: string): string {
  return `${petName}'s walk`;
}

/**
 * "18 min together" — the finished card's title.
 *
 * Minutes, never seconds: this is a keepsake line, and "18 min" is how someone
 * would describe the walk out loud. Rounds up from zero so a genuinely short
 * walk still reads as time spent rather than "0 min".
 */
export function finishedTitle(durationMs: number): string {
  const minutes = Math.max(1, Math.round(durationMs / 60_000));
  return `${minutes} min together`;
}

/**
 * "HOME · WALK SAVED", but only when it is true.
 *
 * `saved` comes from the sync outcome. A walk finished with no signal is real
 * and complete, and it will sync later — but the card cannot say a row exists
 * on the server when it does not. The honest variant costs one word.
 */
export function finishedEyebrow(saved: boolean, packName?: string | null): string {
  const outcome = saved ? 'WALK SAVED' : 'WALK FINISHED';
  // "HOME" is the solo walk's own ending — the geofence it stopped at. A Trail
  // walk did not necessarily end at anyone's home, and saying so would be the
  // one untrue word on the card. The pack takes that slot instead.
  const pack = packName?.trim();
  return pack ? `${clipPackName(pack).toUpperCase()} · ${outcome}` : `HOME · ${outcome}`;
}

/**
 * The Android foreground-service notification — the ONLY thing on screen while
 * a walk runs with the app closed, and therefore the only place some owners
 * will ever read what tracking is doing.
 *
 * Three variants rather than one, because the honest sentence differs:
 *   - solo: nothing leaves the phone.
 *   - a Trail with sharing on: the pack can see where you are, and that has to
 *     be stated here, not only on the screen where it was switched on.
 *   - a Trail with sharing off: on the walk together, but not broadcasting.
 *
 * It says the walk ends on its own in every variant, because that is the
 * reassurance that stops people opening the app to check.
 */
export function trackingNotification(input: {
  petName: string;
  packName?: string | null;
  sharingLocation?: boolean;
}): { title: string; body: string } {
  const pack = input.packName?.trim();
  if (!pack) {
    return {
      title: `${input.petName}'s walk is being tracked`,
      body: 'Pawtchi is measuring the route. The walk ends on its own when you get home.',
    };
  }
  return {
    title: `${input.petName} is walking ${pack}`,
    body: input.sharingLocation
      ? 'Pawtchi is measuring your route and showing the pack where you are. The walk ends on its own when you get home.'
      : 'Pawtchi is measuring your route. Your position stays private, and the walk ends on its own when you get home.',
  };
}

/** "1.4 km · 6 sniffs".
 *
 *  The handoff's third clause, "1 new street", is deliberately absent: that
 *  count is a server-side column (`walk_sessions.new_street_count`, read by the
 *  notify-dispatch function) and does not exist on the device at the moment a
 *  walk ends — least of all for a walk finished offline. */
export function finishedSummary(distanceKm: number, sniffCount: number): string {
  return `${distanceKm.toFixed(1)} km · ${sniffCount} ${sniffCount === 1 ? 'sniff' : 'sniffs'}`;
}
