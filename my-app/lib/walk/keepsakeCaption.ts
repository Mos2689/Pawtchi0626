/**
 * What to say about a moment.
 *
 * A photograph in a camera roll is an image. The same photograph with "Bunny,
 * Thursday morning — 12 minutes in, near Arpora, 23°" under it is a memory, and
 * the difference is entirely in facts Pawtchi already holds and was discarding.
 *
 * ── The rule that keeps this honest ──
 * Every line is DERIVED, never decorated. If the weather was not recorded there
 * is no weather line; if the coordinate never resolved there is no place. The
 * feature earns its warmth by being specific about a real walk, so inventing a
 * detail to fill a gap would cost exactly the thing it is trying to buy.
 *
 * ── The note ──
 * At most one, and usually none. It carries the rarer observation — that this
 * spot has been photographed before, or that the walk was a long time ago —
 * which is the line that makes an ordinary photo land. Rationed hard: a
 * resonant line under every single photo is wallpaper by the third one.
 *
 * Pure. All strings comply with the Pawtchi Copy Spec v1 (no exclamation marks,
 * never "your pet", calm sentence case), enforced by keepsakeCaption.test.ts.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface KeepsakeCaptionInput {
  /** Capture time, ms. */
  capturedAt: number;
  /** Seconds into the walk. */
  elapsedS?: number | null;
  /** Metres covered by the time it was taken. */
  distanceM?: number | null;
  petName?: string | null;
  /** The walk's place — "Arpora". */
  placeLabel?: string | null;
  weather?: { tempC: number; label: string } | null;
  /**
   * Earlier moments this pet has at the same spot, excluding this one.
   *
   * The whole point of place memory, surfaced as a sentence: walking the same
   * corner repeatedly stops being repetition and becomes a record of it.
   */
  priorVisits?: number | null;
  /** Now, for working out how long ago this was. */
  now: number;
}

/** What a fact IS, so the page can give it the right glyph. */
export type KeepsakeFactKind = 'elapsed' | 'distance' | 'place' | 'weather';

export interface KeepsakeFact {
  kind: KeepsakeFactKind;
  text: string;
}

/**
 * The note, split so one phrase inside it can be emphasised.
 *
 * Returned in three parts rather than as one string because the number is the
 * point — "7 times" carries the whole observation and has to be able to look
 * like it does. Building the sentence here and letting the page colour the
 * middle keeps the copy in one place and the styling in the other.
 */
export interface KeepsakeNote {
  /**
   * Which observation this is.
   *
   * The two are chosen by priority below and read very differently — one is a
   * count of a shared habit, the other is the calendar. A surface that renders
   * the note as anything other than the sentence (the viewer sets it as a stat)
   * needs to know which it got, and inferring it by re-testing `priorVisits`
   * would duplicate the priority rule where it could silently disagree.
   */
  kind: 'visits' | 'ago';
  lead: string;
  highlight: string;
  trail: string;
}

export interface KeepsakeCaption {
  /** "THURSDAY, 20 AUGUST" — the eyebrow above the headline. */
  dateLine: string;
  /** The moment, and whose it is. */
  headline: string;
  /** Where in the walk, where in the world, what it was like. */
  facts: KeepsakeFact[];
  /** The rarer, resonant line. Null most of the time, by design. */
  note: KeepsakeNote | null;
}

/**
 * Part of the day, in the words people actually use.
 *
 * Boundaries chosen so a dog walk lands where its owner would say it did: a
 * 6am walk is the morning, a 7pm one is the evening.
 */
export function partOfDay(capturedAt: number): string {
  const hour = new Date(capturedAt).getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

/** "12 minutes in" — how far into the walk this happened. */
export function elapsedPhrase(elapsedS: number | null | undefined): string | null {
  if (elapsedS == null || !Number.isFinite(elapsedS) || elapsedS < 0) return null;
  const minutes = Math.round(elapsedS / 60);
  if (minutes < 1) return 'Right at the start';
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} in`;
}

/** "0.9 km in" — how far they had walked by then. */
export function distancePhrase(distanceM: number | null | undefined): string | null {
  if (distanceM == null || !Number.isFinite(distanceM) || distanceM < 50) return null;
  const km = distanceM / 1000;
  return km >= 1 ? `${km.toFixed(1)} km in` : `${Math.round(distanceM)} m in`;
}

/** "23°, clear" — only when it was actually recorded. */
export function weatherPhrase(
  weather: { tempC: number; label: string } | null | undefined,
): string | null {
  if (!weather || !Number.isFinite(weather.tempC)) return null;
  const temp = `${Math.round(weather.tempC)}°`;
  const label = weather.label?.trim();
  return label ? `${temp}, ${label.toLowerCase()}` : temp;
}

/**
 * "Three weeks ago" — how long the archive has been holding this.
 *
 * Nothing under a week: telling someone a photo from this morning is "today" is
 * noise, and the line is only worth spending when the answer is a surprise.
 */
export function agoPhrase(capturedAt: number, now: number): string | null {
  const days = Math.floor((now - capturedAt) / DAY_MS);
  if (!Number.isFinite(days) || days < 7) return null;
  if (days < 14) return 'A week ago';
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  const years = Math.round(days / 365);
  return years <= 1 ? 'A year ago' : `${years} years ago`;
}

/** Day name — "Thursday". */
function dayName(capturedAt: number): string {
  return new Date(capturedAt).toLocaleDateString('en-GB', { weekday: 'long' });
}

/** "THURSDAY, 20 AUGUST" — the dateline an editorial page opens on. */
export function dateLineFor(capturedAt: number): string {
  const d = new Date(capturedAt);
  const day = d.toLocaleDateString('en-GB', { weekday: 'long' });
  const rest = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  return `${day}, ${rest}`.toUpperCase();
}

/**
 * Compose the caption.
 *
 * The note is chosen by priority, never stacked: place repetition outranks age,
 * because "you have stopped here before" says something about the relationship
 * and "a year ago" only says something about the calendar.
 */
export function buildKeepsakeCaption(input: KeepsakeCaptionInput): KeepsakeCaption {
  const name = input.petName?.trim();
  const when = `${dayName(input.capturedAt)} ${partOfDay(input.capturedAt)}`;

  // The day stays capitalised even after the name — it is a proper noun, and
  // "Bunny, thursday morning" reads like a typo rather than a caption.
  const headline = name ? `${name}, ${when}` : when;

  const place = input.placeLabel?.trim();
  const facts: KeepsakeFact[] = [];
  const elapsed = elapsedPhrase(input.elapsedS);
  if (elapsed) facts.push({ kind: 'elapsed', text: elapsed });
  const distance = distancePhrase(input.distanceM);
  if (distance) facts.push({ kind: 'distance', text: distance });
  if (place) facts.push({ kind: 'place', text: `Near ${place}` });
  const weather = weatherPhrase(input.weather);
  if (weather) facts.push({ kind: 'weather', text: weather });

  // The visit count INCLUDES the photo being looked at: "stopped here together
  // 7 times" means seven stops, of which this is the seventh.
  const visits = (input.priorVisits ?? 0) + 1;
  let note: KeepsakeNote | null = null;
  if (visits >= 2) {
    note = {
      kind: 'visits',
      lead: 'You’ve stopped here together ',
      highlight: `${visits} times`,
      trail: '.',
    };
  } else {
    const ago = agoPhrase(input.capturedAt, input.now);
    if (ago) note = { kind: 'ago', lead: '', highlight: ago, trail: '.' };
  }

  return { dateLine: dateLineFor(input.capturedAt), headline, facts, note };
}
