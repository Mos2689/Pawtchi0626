/**
 * Guards that the Spots logic stays under the Deno mirror.
 *
 * The per-FILE sync assertion is not repeated here — `lib/email/copy.test.ts`
 * already iterates every entry in MIRROR_GROUPS, so adding a second identical
 * `test.each` would just cost another two minutes of ts-jest for no coverage.
 *
 * What that iteration cannot catch is someone deleting a group: with the group
 * gone there is nothing left to iterate, the sync check goes quiet, and the
 * Edge Function silently keeps running whatever `_shared/spots` last held. That
 * is exactly the failure the August 2026 notification audit found, so it gets
 * its own explicit test.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { MIRROR_GROUPS } = require('../../scripts/sync-notification-shared.js');

interface MirrorGroup {
  name: string;
  appDir: string;
  edgeDir: string;
  files: string[];
}

const groups = MIRROR_GROUPS as MirrorGroup[];

describe('Spots Deno mirror', () => {
  it('mirrors the spots group', () => {
    expect(groups.map(g => g.name)).toContain('spots');
  });

  it('mirrors the walk group dedupe depends on', () => {
    // lib/spots/dedupe.ts imports ../walk/geo for haversineMeters. Without this
    // sibling group the mirrored dedupe.ts would fail to resolve at deploy
    // time rather than at build time.
    expect(groups.map(g => g.name)).toContain('walk');
  });

  it('carries every module the endpoint imports', () => {
    // Mirrors the import list in supabase/functions/nearby-spots/index.ts.
    // A new server-side dependency added there but not here deploys broken.
    const spots = groups.find(g => g.name === 'spots')!;
    for (const file of [
      'types.ts',
      'osmTags.ts',
      'classify.ts',
      'normalize.ts',
      'dedupe.ts',
      'cellKey.ts',
      'overpassQuery.ts',
    ]) {
      expect(spots.files).toContain(file);
    }
  });

  it('does not mirror client-only modules', () => {
    // copy/filters/cluster/rank/directions render or need the user's real
    // position — neither of which the server has. Mirroring them would imply
    // the server can rank or measure, which it deliberately cannot.
    const spots = groups.find(g => g.name === 'spots')!;
    for (const file of ['copy.ts', 'filters.ts', 'cluster.ts', 'rank.ts', 'directions.ts']) {
      expect(spots.files).not.toContain(file);
    }
  });
});
