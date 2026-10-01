/**
 * The walk screen's snapshot: decoded from `community_outing`, or composed
 * ahead of time from what the meetup screen already holds.
 *
 * `decodeOuting` moved here verbatim from communityWalks.ts (perf Train 2) so
 * the composer below can reuse it: the composer builds the SAME document
 * `community_outing` would return and runs it through the SAME decoder, so the
 * roster rules (an unanswered member is `invited`, not absent; a person's dogs
 * are the ones they chose, else all of theirs) cannot drift between the two.
 */

import type {
  CommunityDog,
  CommunityPack,
  CommunityPerson,
  CommunityWalk,
  OutingSnapshot,
  PackMember,
  PackSnapshot,
  WalkAttendance,
} from '../communityWalks';

/** The document both `community_outing` and `community_memory` return. */
export interface OutingDoc {
  walk?: CommunityWalk;
  pack?: CommunityPack;
  people?: {
    user_id: string;
    attendance: Record<string, unknown> | null;
    person?: CommunityPerson;
    dogs?: CommunityDog[];
  }[];
}

/**
 * Turn that document into the snapshot every screen reads.
 *
 * Shared by `loadOuting` and `loadMemory` rather than written twice, because
 * the interesting rule lives here: somebody with NO attendance row is not
 * absent, they simply have not answered. They come back as `invited` in memory
 * with the walk's own `created_at` standing in for an update that never
 * happened. Two copies of that would eventually disagree, and the way it would
 * show is a member quietly missing from one screen and present on the other.
 */
export function decodeOuting(walkId: string, raw: unknown): OutingSnapshot {
  const doc = (raw ?? {}) as OutingDoc;
  if (!doc.walk || !doc.pack) throw new Error('That walk could not be opened.');

  const walk = doc.walk;
  const people = doc.people ?? [];
  const decorate = (entry: (typeof people)[number]): WalkAttendance => ({
    walk_id: walkId,
    user_id: entry.user_id,
    status: 'invited',
    share_location: false,
    checked_in_at: null,
    joined_at: null,
    finished_at: null,
    updated_at: walk.created_at,
    // Spread AFTER the defaults, so a real row wins every field it carries.
    ...(entry.attendance ?? {}),
    person: entry.person,
    dogs: entry.dogs ?? [],
  }) as WalkAttendance;

  return {
    walk,
    pack: doc.pack,
    attendance: people.filter(entry => entry.attendance).map(decorate),
    notAsked: people.filter(entry => !entry.attendance).map(decorate),
  };
}

/** One row of `community_pack_detail.attendance[walkId]` (20261002040000). */
export interface PackAttendanceEntry {
  /** `to_jsonb(a)` — the object community_outing returns as `attendance`. */
  row: Record<string, unknown> & { user_id: string };
  /** The pets this person chose for the walk; empty means "all of theirs". */
  pet_ids?: string[];
}

/**
 * The walk screen's snapshot, built from the meetup screen's data — or null
 * when that could not match what `community_outing` would return:
 *   - somebody answered the walk who is not (or no longer) a member, so their
 *     name and dogs are not in the meetup data;
 *   - somebody chose a pet that is not among their dogs in the meetup data.
 * Null leaves the caller on the old partial prime, which the network fills.
 */
export function composeOutingSnapshot(input: {
  walk: CommunityWalk;
  pack: CommunityPack;
  members: readonly PackMember[];
  attendance: readonly PackAttendanceEntry[];
}): OutingSnapshot | null {
  const memberById = new Map(input.members.map(member => [member.user_id, member]));
  const answered = new Map<string, PackAttendanceEntry>();
  for (const entry of input.attendance) {
    const userId = entry?.row?.user_id;
    if (typeof userId !== 'string' || !memberById.has(userId)) return null;
    answered.set(userId, entry);
  }

  const people: NonNullable<OutingDoc['people']> = [];
  for (const member of input.members) {
    const entry = answered.get(member.user_id);
    const chosen = entry?.pet_ids ?? [];
    let dogs: CommunityDog[] = member.dogs ?? [];
    if (chosen.length) {
      const byId = new Map(dogs.map(dog => [dog.id, dog]));
      const picked: CommunityDog[] = [];
      for (const petId of chosen) {
        const dog = byId.get(petId);
        if (!dog) return null;
        picked.push(dog);
      }
      dogs = picked;
    }
    people.push({
      user_id: member.user_id,
      attendance: entry ? entry.row : null,
      person: member.person,
      dogs,
    });
  }

  return decodeOuting(input.walk.id, { walk: input.walk, pack: input.pack, people });
}

function displayName(row: WalkAttendance): string {
  const person: CommunityPerson | undefined = row.person ?? undefined;
  return (person?.full_name || person?.username || '').trim().toLowerCase();
}

/**
 * The walk screen's display order, identical however the rows were produced.
 *
 * `community_outing` aggregates its roster without an ORDER BY, so a primed
 * list and the fetched list could hold the same people in different orders,
 * and the rows would visibly shuffle when the fetch landed. Host first, then
 * the order people joined the walk, then by name, then by id; each person's
 * dogs by name then id (the first dog is their avatar).
 */
export function sortRosterForDisplay(
  rows: readonly WalkAttendance[],
  organizerId: string | null | undefined,
): WalkAttendance[] {
  const joined = (row: WalkAttendance) => {
    const at = row.joined_at ? Date.parse(row.joined_at) : NaN;
    return Number.isFinite(at) ? at : Number.POSITIVE_INFINITY;
  };
  const sortedDogs = (dogs: CommunityDog[] | undefined) =>
    dogs && dogs.length > 1
      ? [...dogs].sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      : dogs;
  return [...rows]
    .sort((a, b) => {
      const hostA = a.user_id === organizerId ? 0 : 1;
      const hostB = b.user_id === organizerId ? 0 : 1;
      if (hostA !== hostB) return hostA - hostB;
      const byJoin = joined(a) - joined(b);
      if (byJoin) return byJoin;
      const byName = displayName(a).localeCompare(displayName(b));
      if (byName) return byName;
      return a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0;
    })
    .map(row => {
      const dogs = sortedDogs(row.dogs);
      return dogs === row.dogs ? row : { ...row, dogs };
    });
}

/**
 * My dogs, from my own row in the meetup this walk belongs to.
 *
 * The same dogs `listMyDogs` returns — `community_pack_detail` builds a
 * member's dogs with that query's filter (owner, species dog) and order
 * (created_at) — so the walk screen can draw its picker and pick a dog on the
 * first frame instead of after a round trip. Null when this person has no row
 * there (no snapshot, or not a member): the caller reads them as before.
 */
export function seedDogsFromPack(
  snapshot: PackSnapshot | null | undefined,
  userId: string | null | undefined,
): CommunityDog[] | null {
  if (!snapshot || !userId) return null;
  const me = snapshot.members.find(member => member.user_id === userId);
  return me ? me.dogs ?? [] : null;
}

/**
 * The dog a walk starts with, by the walk screen's long-standing rule: the
 * active pet, else the first of my dogs, else none.
 */
export function initialDogSelection(
  activePetId: string | null | undefined,
  dogs: readonly CommunityDog[],
): string[] {
  if (activePetId) return [activePetId];
  return dogs[0] ? [dogs[0].id] : [];
}
