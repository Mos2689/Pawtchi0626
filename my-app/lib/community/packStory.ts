/**
 * The pack story — what the shared-walk Instagram story says, decided purely.
 *
 * The old share card was a label: "PAWTCHI · PACK MEMORY", the walk's title and
 * "Sma walked with the pack." True, and it narrated nothing. The story tells
 * what happened — who walked together, when, for how long — in the dogs' own
 * names, over the owner's own photos and each walker's line.
 *
 * Everything here is pure so the copy can be pinned by tests: brand rules
 * (dogs' names, sentence case, no exclamation marks) are easy to drift from one
 * render at a time.
 *
 * ── What may leave the phone ───────────────────────────────────────────────
 *
 *   * Photos: the OWNER's own only. Other walkers' photos stay theirs.
 *   * Lines: map-free shapes (lib/communityRouteArtwork) — no streets, labels,
 *     coordinates, and no start or end markers.
 *   * Dogs' names: every dog on the walk (the user's call, 2026-09-25).
 */

import { color } from '../../constants/design';

export interface StoryWalker {
  userId: string;
  /** This walker's dogs, first one leads. */
  dogNames: string[];
}

/** One colour per walker, in brand order — see `color.packStoryLines`. */
export function storyLineColor(index: number): string {
  const lines = color.packStoryLines;
  return lines[index % lines.length];
}

/** Walkers ordered for the story: the viewer first, everyone else as given. */
export function orderWalkers(walkers: readonly StoryWalker[], viewerId: string | null): StoryWalker[] {
  const mine = walkers.filter(walker => walker.userId === viewerId);
  const rest = walkers.filter(walker => walker.userId !== viewerId);
  return [...mine, ...rest];
}

/** Every dog on the walk, viewer's first, without repeats or blanks. */
export function storyDogNames(walkers: readonly StoryWalker[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const walker of walkers) {
    for (const raw of walker.dogNames) {
      const name = raw?.trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      names.push(name);
    }
  }
  return names;
}

/** "Sma", "Sma and Bruno", "Sma, Bruno and Olive", "Sma, Bruno and 2 more". */
export function dogsLine(names: readonly string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function partOfDay(hour: number): string {
  if (hour < 5) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

/**
 * The headline, built from the walk rather than typed into it.
 *
 *   one dog      "Sma's Friday walk"
 *   two          "Sma and Bruno, side by side"
 *   three        "Sma, Bruno and Olive"
 *   four or more "Sma and the pack of 5"
 *
 * Falls back to the meetup's own title when no dog is known, so the card is
 * never headed by a placeholder.
 */
export function storyHeadline(input: {
  dogNames: readonly string[];
  at: Date | null;
  fallbackTitle: string;
}): string {
  const { dogNames } = input;
  if (dogNames.length === 0) return input.fallbackTitle;
  if (dogNames.length === 1) {
    const day = input.at ? WEEKDAYS[input.at.getDay()] : null;
    return day ? `${dogNames[0]}’s ${day} walk` : `${dogNames[0]}’s walk with the pack`;
  }
  if (dogNames.length === 2) return `${dogNames[0]} and ${dogNames[1]}, side by side`;
  if (dogNames.length === 3) return `${dogNames[0]}, ${dogNames[1]} and ${dogNames[2]}`;
  return `${dogNames[0]} and the pack of ${dogNames.length}`;
}

/** "Friday evening · 6 min together · 4 moments" — only the parts we know. */
export function storySubline(input: {
  at: Date | null;
  seconds: number | null;
  moments: number;
}): string {
  const parts: string[] = [];
  if (input.at) parts.push(`${WEEKDAYS[input.at.getDay()]} ${partOfDay(input.at.getHours())}`);
  if (input.seconds && input.seconds >= 60) parts.push(`${Math.round(input.seconds / 60)} min together`);
  if (input.moments > 0) parts.push(`${input.moments} ${input.moments === 1 ? 'moment' : 'moments'}`);
  return parts.join(' · ');
}

/** The big sticker: minutes together, or null when the walk has no length. */
export function minutesTogether(seconds: number | null): number | null {
  if (!seconds || seconds < 60) return null;
  return Math.round(seconds / 60);
}

/**
 * Up to three of the owner's own photos, spread across the walk — first,
 * middle, last — rather than the three taken in the same ten seconds.
 */
export function pickStoryPhotos<T extends { capturedAt: number }>(photos: readonly T[], max = 3): T[] {
  const sorted = [...photos].sort((a, b) => a.capturedAt - b.capturedAt);
  if (sorted.length <= max) return sorted;
  const picked: T[] = [];
  for (let i = 0; i < max; i += 1) {
    picked.push(sorted[Math.round((i * (sorted.length - 1)) / (max - 1))]);
  }
  return picked;
}

/**
 * Where two walkers' lines come closest, in artwork units — the "we met here"
 * ring. Null when they never come within `within` of each other, because a
 * ring between two lines that never touched would be claiming a meeting.
 */
export function meetingPoint(
  a: readonly { x: number; y: number }[],
  b: readonly { x: number; y: number }[],
  within = 18,
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestDistance = Infinity;
  for (const p of a) {
    for (const q of b) {
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < bestDistance) {
        bestDistance = d;
        best = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      }
    }
  }
  return bestDistance <= within ? best : null;
}

/** "25 Sep" for the date chip. */
export function storyDateChip(at: Date | null): string {
  if (!at) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${WEEKDAYS[at.getDay()].slice(0, 3)}, ${at.getDate()} ${months[at.getMonth()]}`;
}
