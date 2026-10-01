/**
 * The composed walk screen must be the walk screen `community_outing` returns.
 *
 * perf-walk-instant-open paints the walk from the meetup's own read
 * (`community_pack_detail` + its `attendance`, 20261002040000) and only
 * reconciles with `community_outing` behind it. That is only safe if the two
 * agree, row for row — otherwise the screen would draw one roster and swap it
 * for another a second later.
 *
 * So these tests do not compare against hand-written expectations. They hold
 * ONE fixture database, run it through a model of each SQL function (the
 * models restate the migrations' rules, including community_outing's missing
 * ORDER BY), and require the composed snapshot to deep-equal the decoded one.
 * Where the composer cannot match — an answer from a non-member, a chosen pet
 * the meetup does not list — it must say so with null rather than guess.
 */

import type { CommunityPack, CommunityWalk, PackMember, PackSnapshot, WalkAttendance } from '../communityWalks';
import {
  composeOutingSnapshot,
  decodeOuting,
  initialDogSelection,
  seedDogsFromPack,
  sortRosterForDisplay,
  type OutingDoc,
  type PackAttendanceEntry,
} from './outingDoc';

// ── A tiny database ─────────────────────────────────────────────────────────

interface Pet { id: string; owner_id: string; name: string; image_url: string | null; species: 'dog' | 'cat'; created_at: string }
interface AttendanceRow {
  walk_id: string;
  user_id: string;
  status: string;
  share_location: boolean;
  checked_in_at: string | null;
  joined_at: string | null;
  finished_at: string | null;
  updated_at: string;
}
interface Db {
  members: { user_id: string; role: 'owner' | 'member'; joined_at: string }[];
  profiles: Record<string, { id: string; username: string | null; full_name: string | null; avatar_url: string | null }>;
  pets: Pet[];
  attendance: AttendanceRow[];
  participantPets: { walk_id: string; user_id: string; pet_id: string; joined_at: string }[];
}

const pack: CommunityPack = {
  id: 'p1',
  name: 'Bondi mornings',
  owner_id: 'host',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

const walk: CommunityWalk = {
  id: 'w1',
  pack_id: 'p1',
  organizer_id: 'host',
  title: 'Saturday loop',
  scheduled_for: '2026-10-03T07:30:00Z',
  meeting_label: 'North Bondi',
  meeting_lat: null,
  meeting_lng: null,
  note: null,
  state: 'planned',
  started_at: null,
  ended_at: null,
  created_at: '2026-09-30T09:00:00Z',
  updated_at: '2026-09-30T09:00:00Z',
};

const person = (id: string, full_name: string | null) => ({ id, username: id, full_name, avatar_url: null });
const pet = (id: string, owner_id: string, name: string, created_at: string, species: Pet['species'] = 'dog'): Pet =>
  ({ id, owner_id, name, image_url: null, species, created_at });
const answer = (user_id: string, status: string, extra: Partial<AttendanceRow> = {}): AttendanceRow => ({
  walk_id: 'w1',
  user_id,
  status,
  share_location: false,
  checked_in_at: null,
  joined_at: null,
  finished_at: null,
  updated_at: '2026-09-30T10:00:00Z',
  ...extra,
});

function baseDb(): Db {
  return {
    members: [
      { user_id: 'host', role: 'owner', joined_at: '2026-09-01T00:00:00Z' },
      { user_id: 'ana', role: 'member', joined_at: '2026-09-02T00:00:00Z' },
      { user_id: 'ben', role: 'member', joined_at: '2026-09-03T00:00:00Z' },
      { user_id: 'cy', role: 'member', joined_at: '2026-09-04T00:00:00Z' },
    ],
    profiles: {
      host: person('host', 'Pradip'),
      ana: person('ana', 'Ana'),
      ben: person('ben', 'Ben'),
      cy: person('cy', 'Cy'),
    },
    pets: [
      pet('sma', 'host', 'Sma', '2026-01-01T00:00:00Z'),
      pet('olive', 'ana', 'Olive', '2026-01-02T00:00:00Z'),
      pet('arlo', 'ana', 'Arlo', '2026-01-01T00:00:00Z'),
      pet('miso', 'ben', 'Miso', '2026-01-03T00:00:00Z'),
      pet('tom', 'ben', 'Tom', '2026-01-04T00:00:00Z', 'cat'),
    ],
    attendance: [],
    participantPets: [],
  };
}

// ── Models of the two SQL functions ─────────────────────────────────────────

const pick = (p: Pet) => ({ id: p.id, owner_id: p.owner_id, name: p.name, image_url: p.image_url });

/** Owner's dogs, species 'dog', by created_at — both functions' fallback list. */
function dogsOf(db: Db, userId: string) {
  return db.pets
    .filter(p => p.owner_id === userId && p.species === 'dog')
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(pick);
}

/** 20260922010000 community_outing — roster = members ∪ attendees, NO order. */
function communityOuting(db: Db): OutingDoc {
  const ids = [...new Set([...db.members.map(m => m.user_id), ...db.attendance.map(a => a.user_id)])];
  return {
    walk,
    pack,
    // Reversed on purpose: the SQL aggregates without ORDER BY, so nothing may
    // depend on the order these arrive in.
    people: ids.reverse().map(userId => {
      const row = db.attendance.find(a => a.user_id === userId) ?? null;
      // JOIN pets with no species filter, and again no ORDER BY.
      const chosen = db.participantPets
        .filter(pp => pp.user_id === userId)
        .map(pp => db.pets.find(p => p.id === pp.pet_id))
        .filter((p): p is Pet => !!p)
        .map(pick)
        .reverse();
      return {
        user_id: userId,
        attendance: row ? { ...row } : null,
        person: db.profiles[userId] ?? (null as never),
        dogs: chosen.length ? chosen : dogsOf(db, userId),
      };
    }),
  };
}

/** 20261002040000 community_pack_detail — members by joined_at, plus attendance. */
function packDetail(db: Db): { members: unknown[]; attendance: Record<string, PackAttendanceEntry[]> } {
  return {
    members: [...db.members]
      .sort((a, b) => a.joined_at.localeCompare(b.joined_at))
      .map(m => ({
        pack_id: 'p1',
        user_id: m.user_id,
        role: m.role,
        joined_at: m.joined_at,
        notifications_muted: false,
        person: db.profiles[m.user_id] ?? null,
        dogs: dogsOf(db, m.user_id),
      })),
    attendance: {
      w1: [...db.attendance]
        .sort((a, b) => a.user_id.localeCompare(b.user_id))
        .map(a => ({
          row: { ...a },
          pet_ids: db.participantPets
            .filter(pp => pp.user_id === a.user_id)
            .sort((x, y) => x.joined_at.localeCompare(y.joined_at) || x.pet_id.localeCompare(y.pet_id))
            .map(pp => pp.pet_id),
        })),
    },
  };
}

/** What `loadPack` does to each member row before anything else sees it. */
function asLoadedMembers(rows: unknown[]): PackMember[] {
  return (rows as any[]).map(row => ({
    ...row,
    person: row.person ?? undefined,
    dogs: Array.isArray(row.dogs) ? row.dogs : [],
  }));
}

/**
 * Compare as the screen draws: in display order, with a missing profile the
 * same whether it arrived as null (SQL) or undefined (loadPack's mapping).
 */
function asDrawn(rows: WalkAttendance[]) {
  return sortRosterForDisplay(rows, walk.organizer_id).map(row => ({ ...row, person: row.person ?? null }));
}

function expectParity(db: Db) {
  const fetched = decodeOuting('w1', communityOuting(db));
  const detail = packDetail(db);
  const composed = composeOutingSnapshot({
    walk,
    pack,
    members: asLoadedMembers(detail.members),
    attendance: detail.attendance.w1,
  });
  expect(composed).not.toBeNull();
  expect(composed!.walk).toEqual(fetched.walk);
  expect(composed!.pack).toEqual(fetched.pack);
  expect(asDrawn(composed!.attendance)).toEqual(asDrawn(fetched.attendance));
  expect(asDrawn(composed!.notAsked)).toEqual(asDrawn(fetched.notAsked));
  expect(composed!.partial).toBeUndefined();
  return composed!;
}

describe('composeOutingSnapshot — parity with community_outing', () => {
  it('a walk nobody has answered: the whole meetup, not asked, with all their dogs', () => {
    const composed = expectParity(baseDb());
    expect(composed.attendance).toEqual([]);
    expect(composed.notAsked.map(row => row.user_id).sort()).toEqual(['ana', 'ben', 'cy', 'host']);
    // A member's cat is not walking anywhere.
    expect(composed.notAsked.find(row => row.user_id === 'ben')!.dogs!.map(dog => dog.id)).toEqual(['miso']);
  });

  it('answers keep every field the server sent; the unasked keep the defaults', () => {
    const db = baseDb();
    db.attendance = [
      answer('host', 'coming'),
      answer('ana', 'invited'),
      answer('ben', 'cant_make_it', { share_location: true }),
    ];
    const composed = expectParity(db);
    expect(composed.attendance.map(row => row.user_id).sort()).toEqual(['ana', 'ben', 'host']);
    const cy = composed.notAsked.find(row => row.user_id === 'cy')!;
    expect(cy.status).toBe('invited');
    expect(cy.updated_at).toBe(walk.created_at);
  });

  it('an active walk: the dogs someone chose, not all of theirs', () => {
    const db = baseDb();
    db.attendance = [
      answer('host', 'walking', { joined_at: '2026-10-03T07:31:00Z' }),
      answer('ana', 'walking', { joined_at: '2026-10-03T07:33:00Z' }),
    ];
    db.participantPets = [
      { walk_id: 'w1', user_id: 'ana', pet_id: 'olive', joined_at: '2026-10-03T07:33:00Z' },
      { walk_id: 'w1', user_id: 'host', pet_id: 'sma', joined_at: '2026-10-03T07:31:00Z' },
    ];
    const composed = expectParity(db);
    expect(composed.attendance.find(row => row.user_id === 'ana')!.dogs!.map(dog => dog.id)).toEqual(['olive']);
  });

  it('both dogs chosen, in whatever order they were picked', () => {
    const db = baseDb();
    db.attendance = [answer('ana', 'walking')];
    db.participantPets = [
      { walk_id: 'w1', user_id: 'ana', pet_id: 'olive', joined_at: '2026-10-03T07:33:00Z' },
      { walk_id: 'w1', user_id: 'ana', pet_id: 'arlo', joined_at: '2026-10-03T07:34:00Z' },
    ];
    expectParity(db);
  });

  it('a member with no profile row', () => {
    const db = baseDb();
    delete (db.profiles as Record<string, unknown>).cy;
    db.attendance = [answer('cy', 'coming')];
    expectParity(db);
  });

  it('a member with no dogs at all', () => {
    const db = baseDb();
    db.members.push({ user_id: 'dee', role: 'member', joined_at: '2026-09-05T00:00:00Z' });
    db.profiles.dee = person('dee', 'Dee');
    db.attendance = [answer('dee', 'coming')];
    expectParity(db);
  });
});

describe('composeOutingSnapshot — refuses what it cannot reproduce', () => {
  const compose = (db: Db) => {
    const detail = packDetail(db);
    return composeOutingSnapshot({ walk, pack, members: asLoadedMembers(detail.members), attendance: detail.attendance.w1 });
  };

  it('somebody answered who is not in the meetup', () => {
    const db = baseDb();
    db.attendance = [answer('stranger', 'coming')];
    // community_outing WOULD list them (roster is members ∪ attendees), and the
    // meetup read has neither their name nor their dogs. Null, not a guess.
    expect(communityOuting(db).people!.some(p => p.user_id === 'stranger')).toBe(true);
    expect(compose(db)).toBeNull();
  });

  it('somebody chose a pet the meetup does not list as their dog', () => {
    const db = baseDb();
    db.attendance = [answer('ben', 'walking')];
    db.participantPets = [{ walk_id: 'w1', user_id: 'ben', pet_id: 'tom', joined_at: '2026-10-03T07:31:00Z' }];
    expect(compose(db)).toBeNull();
  });

  it('a malformed entry is a null, never a throw', () => {
    const members = asLoadedMembers(packDetail(baseDb()).members);
    expect(composeOutingSnapshot({ walk, pack, members, attendance: [{} as PackAttendanceEntry] })).toBeNull();
    expect(composeOutingSnapshot({ walk, pack, members, attendance: [null as unknown as PackAttendanceEntry] })).toBeNull();
  });
});

describe('sortRosterForDisplay', () => {
  const row = (user_id: string, name: string, joined_at: string | null = null, dogs: string[] = []): WalkAttendance => ({
    walk_id: 'w1',
    user_id,
    status: 'coming',
    share_location: false,
    checked_in_at: null,
    joined_at,
    finished_at: null,
    updated_at: '2026-09-30T10:00:00Z',
    person: { id: user_id, username: null, full_name: name, avatar_url: null },
    dogs: dogs.map(dog => ({ id: dog.toLowerCase(), name: dog, image_url: null })),
  });

  it('host first, then by when they joined (not yet joined last), then name, then id', () => {
    const rows = [
      row('z', 'zed'),
      row('b', 'Bea', '2026-10-03T07:40:00Z'),
      row('host', 'Pradip', '2026-10-03T07:50:00Z'),
      row('a', 'Abe', '2026-10-03T07:35:00Z'),
      row('y', 'Amy'),
      row('x', 'amy'),
    ];
    expect(sortRosterForDisplay(rows, 'host').map(r => r.user_id)).toEqual(['host', 'a', 'b', 'x', 'y', 'z']);
  });

  it('sorts each person\'s dogs by name, without touching the input', () => {
    const input = [row('a', 'Abe', null, ['Olive', 'Arlo'])];
    const [out] = sortRosterForDisplay(input, 'host');
    expect(out.dogs!.map(dog => dog.name)).toEqual(['Arlo', 'Olive']);
    expect(input[0].dogs!.map(dog => dog.name)).toEqual(['Olive', 'Arlo']);
  });

  it('keeps a row object when it had nothing to reorder', () => {
    const input = [row('a', 'Abe', null, ['Olive'])];
    expect(sortRosterForDisplay(input, 'host')[0]).toBe(input[0]);
  });
});

describe('seedDogsFromPack / initialDogSelection', () => {
  const snapshot = { members: asLoadedMembers(packDetail(baseDb()).members) } as PackSnapshot;

  it('my dogs from my own row, exactly as listed', () => {
    expect(seedDogsFromPack(snapshot, 'ana')!.map(dog => dog.id)).toEqual(['arlo', 'olive']);
  });

  it('null when there is nothing to seed from — the caller reads them instead', () => {
    expect(seedDogsFromPack(null, 'ana')).toBeNull();
    expect(seedDogsFromPack(snapshot, undefined)).toBeNull();
    expect(seedDogsFromPack(snapshot, 'stranger')).toBeNull();
  });

  it('the active pet, else my first dog, else nothing', () => {
    const dogs = seedDogsFromPack(snapshot, 'ana')!;
    expect(initialDogSelection('olive', dogs)).toEqual(['olive']);
    expect(initialDogSelection(null, dogs)).toEqual(['arlo']);
    expect(initialDogSelection(undefined, [])).toEqual([]);
  });
});
