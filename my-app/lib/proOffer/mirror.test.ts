/**
 * Guards that the pro-offer rule engine stays under the Deno mirror.
 *
 * The per-file byte comparison is already run by `lib/email/copy.test.ts`,
 * which iterates every entry in MIRROR_GROUPS. What that iteration cannot
 * catch is someone deleting the group: with the group gone there is nothing
 * left to iterate, the sync check goes quiet, and pro-offer-sweep keeps
 * running whatever `_shared/proOffer` last held.
 *
 * That is the August 2026 notification failure exactly — a dashboard-side fork
 * drifting for four months — except that the thing that drifts here decides who
 * gets a permanently discounted subscription. It would surface as a revenue
 * number long after anyone remembered changing a threshold.
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

describe('pro-offer Deno mirror', () => {
  it('mirrors the proOffer group', () => {
    expect(groups.map(g => g.name)).toContain('proOffer');
  });

  it('carries every module the sweep imports', () => {
    // Mirrors the import list in supabase/functions/pro-offer-sweep/index.ts.
    // A new server-side dependency added there but not here deploys broken.
    const proOffer = groups.find(g => g.name === 'proOffer')!;
    for (const file of ['types.ts', 'eligibility.ts']) {
      expect(proOffer.files).toContain(file);
    }
  });

  it('does not mirror the client-only modules', () => {
    // `client.ts` is Supabase + AsyncStorage, `copy.ts` renders a screen, and
    // `pricing.ts` reads a StoreKit product the server never sees. Mirroring
    // any of them would imply the sweep can talk to a device, show somebody a
    // price, or ask a store what something costs. It can do none of those.
    const proOffer = groups.find(g => g.name === 'proOffer')!;
    for (const file of ['client.ts', 'copy.ts', 'pricing.ts']) {
      expect(proOffer.files).not.toContain(file);
    }
  });
});
