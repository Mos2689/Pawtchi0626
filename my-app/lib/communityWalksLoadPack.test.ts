/**
 * `loadPack` — one read for the meetup screen, never a half-built result.
 *
 * It now asks `community_pack_detail` (plus the invitation roster, in the same
 * wave) instead of six reads in two waves. Two things must still hold: a
 * failure caches nothing, and a database that does not have the new function
 * yet falls back to the old reads rather than breaking the screen.
 */

import { joinErrorMessage, joinOuting, loadPack } from './communityWalks';
import { cacheKey, clearCommunityCache, readSnapshot } from './communityCache';
import { resetPerfFlagsForTests, setPerfFlagOverride } from './perfFlags';

type Response = { data: unknown; error: { message: string } | null };
const mockResponses: Record<string, Response> = {};
const mockRpcCalls: { name: string; args: unknown }[] = [];

/** A PostgREST-ish builder: every call chains, awaiting it yields the key's response. */
function chain(key: string) {
  const builder: any = {};
  for (const method of ['select', 'eq', 'in', 'order', 'limit', 'single', 'upsert', 'delete', 'insert', 'update']) {
    builder[method] = () => builder;
  }
  builder.then = (resolve: (r: Response) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(mockResponses[key] ?? { data: null, error: null }).then(resolve, reject);
  return builder;
}

jest.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => chain(table),
    rpc: (name: string, args: unknown) => {
      mockRpcCalls.push({ name, args });
      return chain(`rpc:${name}`);
    },
    auth: { getSession: jest.fn(async () => ({ data: { session: { user: { id: 'u1' } } } })) },
  },
}));

const ok = (data: unknown): Response => ({ data, error: null });
const MISSING: Response = {
  data: null,
  error: { message: 'Could not find the function public.community_pack_detail(p_pack_id) in the schema cache' },
};

beforeEach(() => {
  clearCommunityCache();
  mockRpcCalls.length = 0;
  for (const key of Object.keys(mockResponses)) delete mockResponses[key];
  mockResponses['rpc:community_pack_detail'] = ok({
    pack: { id: 'p1', name: 'Sunday crew', owner_id: 'u1' },
    members: [{
      pack_id: 'p1', user_id: 'u1', role: 'owner', joined_at: '2026-09-01', notifications_muted: false,
      person: { id: 'u1', username: 'sam', full_name: 'Sam', avatar_url: null },
      dogs: [{ id: 'd1', owner_id: 'u1', name: 'Olive', image_url: null }],
    }],
    walks: [],
  });
  mockResponses['rpc:list_pack_invitations'] = ok([]);
  // The legacy six reads, for the fallback path.
  mockResponses.community_packs = ok({ id: 'p1', name: 'Sunday crew', owner_id: 'u1' });
  mockResponses.community_pack_members = ok([{ pack_id: 'p1', user_id: 'u1', role: 'owner', joined_at: '2026-09-01' }]);
  mockResponses.community_walks = ok([]);
  mockResponses.profiles = ok([{ id: 'u1', username: 'sam', full_name: 'Sam', avatar_url: null }]);
  mockResponses.pets = ok([{ id: 'd1', owner_id: 'u1', name: 'Olive', image_url: null }]);
});

describe('loadPack', () => {
  it('builds the roster from one detail read plus the invitations, in one wave', async () => {
    const pack = await loadPack('p1');
    expect(pack.members[0].person?.username).toBe('sam');
    expect(pack.members[0].dogs.map(dog => dog.name)).toEqual(['Olive']);
    expect(mockRpcCalls.map(call => call.name).sort()).toEqual(['community_pack_detail', 'list_pack_invitations']);
    expect(readSnapshot(cacheKey.pack('p1'))).not.toBeNull();
  });

  it('fails, and caches nothing, when the detail read fails', async () => {
    mockResponses['rpc:community_pack_detail'] = { data: null, error: { message: 'pack_access_denied' } };
    await expect(loadPack('p1')).rejects.toThrow('pack_access_denied');
    expect(readSnapshot(cacheKey.pack('p1'))).toBeNull();
  });

  it('fails, and caches nothing, when the invitations fail', async () => {
    mockResponses['rpc:list_pack_invitations'] = { data: null, error: { message: 'invites down' } };
    await expect(loadPack('p1')).rejects.toThrow('invites down');
    expect(readSnapshot(cacheKey.pack('p1'))).toBeNull();
  });

  it('falls back to the old reads on a database without the function', async () => {
    mockResponses['rpc:community_pack_detail'] = MISSING;
    const pack = await loadPack('p1');
    expect(pack.members[0].dogs.map(dog => dog.name)).toEqual(['Olive']);
  });

  it.each([['profiles'], ['pets']])('the fallback still refuses a half-built result when %s fails', async key => {
    mockResponses['rpc:community_pack_detail'] = MISSING;
    mockResponses[key] = { data: null, error: { message: `${key} down` } };
    await expect(loadPack('p1')).rejects.toThrow(`${key} down`);
    expect(readSnapshot(cacheKey.pack('p1'))).toBeNull();
  });
});

describe('joinOuting', () => {
  it('joins — and for the host, starts — in one call', async () => {
    await joinOuting('w1', ['d1'], true, { start: true });
    expect(mockRpcCalls).toEqual([{
      name: 'join_community_walk',
      args: { p_walk_id: 'w1', p_pet_ids: ['d1'], p_share_location: true, p_start: true },
    }]);
  });

  it('turns a refusal into a sentence', async () => {
    mockResponses['rpc:join_community_walk'] = { data: null, error: { message: 'walk_closed' } };
    await expect(joinOuting('w1', ['d1'], false)).rejects.toThrow('This walk has finished.');
  });

  it('falls back to the old writes on a database without the function', async () => {
    mockResponses['rpc:join_community_walk'] = {
      data: null,
      error: { message: 'Could not find the function public.join_community_walk in the schema cache' },
    };
    await expect(joinOuting('w1', ['d1'], false)).resolves.toBeUndefined();
  });

  it('never shouts in its errors', () => {
    for (const code of ['walk_closed', 'pack_host_required', 'walk_access_denied', 'pet_not_yours', 'auth_required', 'x']) {
      expect(joinErrorMessage(code)).not.toContain('!');
    }
  });
});

/**
 * The meetup read primes each listed walk's screen. With perf-walk-instant-open
 * on and the attendance migration deployed, that prime is the whole roster;
 * otherwise it is the plan alone, as before.
 */
describe('loadPack → walk screen prime', () => {
  const plannedWalk = {
    id: 'w1', pack_id: 'p1', organizer_id: 'u1', title: 'Saturday loop', scheduled_for: null,
    meeting_label: 'North Bondi', meeting_lat: null, meeting_lng: null, note: null, state: 'planned',
    started_at: null, ended_at: null, created_at: '2026-09-30T09:00:00Z', updated_at: '2026-09-30T09:00:00Z',
  };
  const withWalk = (extra: Record<string, unknown>) => {
    const base = (mockResponses['rpc:community_pack_detail'].data ?? {}) as Record<string, unknown>;
    mockResponses['rpc:community_pack_detail'] = ok({ ...base, walks: [plannedWalk], ...extra });
  };
  const coming = {
    row: {
      walk_id: 'w1', user_id: 'u1', status: 'coming', share_location: false, checked_in_at: null,
      joined_at: null, finished_at: null, updated_at: '2026-09-30T10:00:00Z',
    },
    pet_ids: ['d1'],
  };

  afterEach(() => resetPerfFlagsForTests());

  it('primes the whole roster when the read carries attendance', async () => {
    setPerfFlagOverride('walkInstantOpen', true);
    withWalk({ attendance: { w1: [coming] } });
    await loadPack('p1');
    const outing = readSnapshot<any>(cacheKey.outing('w1'));
    expect(outing?.partial).toBeFalsy();
    expect(outing?.attendance[0]).toMatchObject({ user_id: 'u1', status: 'coming' });
    expect(outing?.attendance[0].dogs.map((dog: any) => dog.name)).toEqual(['Olive']);
  });

  it('primes the plan alone on a database without the attendance migration', async () => {
    setPerfFlagOverride('walkInstantOpen', true);
    withWalk({});
    await loadPack('p1');
    expect(readSnapshot<any>(cacheKey.outing('w1'))?.partial).toBe(true);
  });

  it('primes the plan alone with the flag off', async () => {
    setPerfFlagOverride('walkInstantOpen', false);
    withWalk({ attendance: { w1: [coming] } });
    await loadPack('p1');
    expect(readSnapshot<any>(cacheKey.outing('w1'))?.partial).toBe(true);
  });

  it('shrugs off an attendance field it does not understand', async () => {
    setPerfFlagOverride('walkInstantOpen', true);
    withWalk({ attendance: 'nonsense' });
    await expect(loadPack('p1')).resolves.toBeDefined();
    expect(readSnapshot<any>(cacheKey.outing('w1'))?.partial).toBe(true);
  });
});
