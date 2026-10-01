/**
 * `listTrailRoutes` — Home's trail lines, one request instead of three.
 *
 * Three things must hold: the RPC's rows become the same map the three reads
 * produced (one line per trail, never a single-point "line"); a database
 * without the function still gets its lines from the three reads; and a real
 * failure rejects, so Home keeps the lines it already drew.
 */

import { listTrailRoutes } from './communityWalks';

type Response = { data: unknown; error: { message: string } | null };
const mockResponses: Record<string, Response> = {};
const mockCalls: string[] = [];

/** A PostgREST-ish builder: every call chains, awaiting it yields the key's response. */
function chain(key: string) {
  const builder: any = {};
  for (const method of ['select', 'eq', 'in', 'order', 'limit']) builder[method] = () => builder;
  builder.then = (resolve: (r: Response) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(mockResponses[key] ?? { data: null, error: null }).then(resolve, reject);
  return builder;
}

jest.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      mockCalls.push(table);
      return chain(table);
    },
    rpc: (name: string) => {
      mockCalls.push(`rpc:${name}`);
      return chain(`rpc:${name}`);
    },
  },
}));

const line = (n: number) => Array.from({ length: n }, (_, i) => ({ lat: -33.89 + i * 0.001, lng: 151.27 }));

beforeEach(() => {
  mockCalls.length = 0;
  for (const key of Object.keys(mockResponses)) delete mockResponses[key];
});

describe('listTrailRoutes', () => {
  it('asks nothing for no trails', async () => {
    await expect(listTrailRoutes([])).resolves.toEqual({});
    expect(mockCalls).toEqual([]);
  });

  it('one request, one line per trail', async () => {
    mockResponses['rpc:community_trail_routes'] = {
      data: [
        { pack_id: 'p1', route: line(3) },
        { pack_id: 'p2', route: line(2) },
      ],
      error: null,
    };
    const routes = await listTrailRoutes(['p1', 'p2', 'p3']);
    expect(Object.keys(routes).sort()).toEqual(['p1', 'p2']);
    expect(routes.p1).toHaveLength(3);
    expect(mockCalls).toEqual(['rpc:community_trail_routes']);
  });

  it('never draws a dot, or something that is not a line', async () => {
    mockResponses['rpc:community_trail_routes'] = {
      data: [
        { pack_id: 'p1', route: line(1) },
        { pack_id: 'p2', route: null },
        { pack_id: 'p3', route: { lat: 1, lng: 2 } },
        { pack_id: null, route: line(4) },
      ],
      error: null,
    };
    await expect(listTrailRoutes(['p1', 'p2', 'p3'])).resolves.toEqual({});
  });

  it('falls back to the three reads on a database without the function', async () => {
    mockResponses['rpc:community_trail_routes'] = {
      data: null,
      error: { message: 'Could not find the function public.community_trail_routes(p_pack_ids) in the schema cache' },
    };
    mockResponses.community_walks = { data: [{ id: 'w1', pack_id: 'p1', ended_at: '2026-09-30T08:00:00Z' }], error: null };
    mockResponses.community_walk_sessions = { data: [{ walk_id: 'w1', walk_session_id: 's1' }], error: null };
    mockResponses.walk_sessions = { data: [{ id: 's1', route: line(5) }], error: null };
    const routes = await listTrailRoutes(['p1']);
    expect(routes.p1).toHaveLength(5);
    expect(mockCalls).toEqual(['rpc:community_trail_routes', 'community_walks', 'community_walk_sessions', 'walk_sessions']);
  });

  it('rejects on a real failure, so Home keeps the lines it has', async () => {
    mockResponses['rpc:community_trail_routes'] = { data: null, error: { message: 'canceling statement due to statement timeout' } };
    await expect(listTrailRoutes(['p1'])).rejects.toThrow('statement timeout');
    expect(mockCalls).toEqual(['rpc:community_trail_routes']);
  });
});
