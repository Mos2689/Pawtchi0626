/**
 * The trail location disclosure must never claim the route is private.
 *
 * ── The defect this exists to prevent coming back ──────────────────────────
 *
 * `LocationDisclosure` was shown, unchanged, before a solo walk and before a
 * Trail walk. Its copy said:
 *
 *     "Only you can see it, and it is never used for advertising."
 *
 * True of a solo walk. False of a Trail: the recorded route joins the walk's
 * shared memory through `community_members_read_linked_personal_walks`, where
 * everyone on that walk reads the polyline, the pace, the stops and the
 * reverse-geocoded place names. And `app/community/walk/[walkId]/index.tsx`
 * named this very screen as the consent for that sharing — so the app's stated
 * basis for disclosing a route was a sentence promising it would not be.
 *
 * ── Why a test rather than a careful comment ───────────────────────────────
 *
 * Because the failure is invisible. A wrong privacy promise renders beautifully,
 * ships through review, and is only discovered by somebody reading the code
 * against the database months later. Nothing crashes. Nobody is told. The same
 * shape as the community event-type gap next door in lib/notifications.
 *
 * The solo branch is deliberately left alone: "only you can see it" is TRUE
 * there and should keep saying so. This test pins the distinction, not the
 * absence of the phrase from the file.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const DISCLOSURE = path.join(ROOT, 'components', 'walk', 'LocationDisclosure.tsx');

const source = fs.readFileSync(DISCLOSURE, 'utf8');

/**
 * The trail branch, as written: `{trail ? (...) : (...)}`.
 *
 * Extracted rather than searched for whole-file, because the solo branch in the
 * same file legitimately contains the phrase this is banning.
 */
function trailBranch(): string {
  const start = source.indexOf('{trail ? (');
  expect(start).toBeGreaterThan(-1);
  const elseAt = source.indexOf(') : (', start);
  expect(elseAt).toBeGreaterThan(start);
  return source.slice(start, elseAt);
}

describe('trail location disclosure', () => {
  it('still has a variant at all', () => {
    // If somebody collapses this back to one copy, everything below passes
    // vacuously — so the existence of the split is the first assertion.
    expect(source).toContain("variant === 'trail'");
    expect(source).toContain('{trail ? (');
  });

  it('never tells a trail walker that only they can see the route', () => {
    const branch = trailBranch().toLowerCase();
    expect(branch).not.toContain('only you');
    expect(branch).not.toContain('only your');
  });

  it('says who does see it', () => {
    const branch = trailBranch().toLowerCase();
    // A disclosure that merely omits the false claim is not yet a disclosure.
    // It has to name the audience.
    expect(branch).toContain('everyone');
  });

  it('keeps the true claim on the solo branch', () => {
    // The solo route IS private, and removing that reassurance to make this
    // test pass would be a loss, not a fix.
    const elseAt = source.indexOf(') : (');
    const soloBranch = source.slice(elseAt, source.indexOf(')}', elseAt)).toLowerCase();
    expect(soloBranch).toContain('only you');
  });
});
