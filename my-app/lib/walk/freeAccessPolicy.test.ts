import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');

const ENTRYPOINT_ROOTS = [
  path.join(ROOT, 'app'),
  path.join(ROOT, 'components'),
];

function sourceFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return /\.tsx?$/.test(entry.name) ? [absolute] : [];
  });
}

describe('walk free-access policy', () => {
  test('every UI start intent is free from a nearby subscription or paywall gate', () => {
    const callers: string[] = [];

    for (const file of ENTRYPOINT_ROOTS.flatMap(sourceFiles)) {
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\barmWalkStart\s*\(/g)) {
        callers.push(path.relative(ROOT, file));
        const callIndex = match.index ?? 0;
        const localFlow = source.slice(Math.max(0, callIndex - 220), callIndex + 260);
        expect(localFlow).not.toMatch(/hasFullAccess|isPro|\/paywall/);
      }
    }

    // Home, Walk Here, the spot arrival prompt, Activity, Inbox, the active tab
    // bar, and the retired dock kept as a reusable component. If one disappears,
    // review the policy surface rather than silently weakening this guard.
    //
    // The arrival prompt is the newest and the one most worth stating plainly:
    // a walk begun by an owner who DROVE to a park is free on exactly the same
    // terms as one begun at the front door. Tracking has never been the paid
    // thing, and a car journey is not the seam to start charging at.
    expect(callers).toHaveLength(7);
  });

  test('the tracking screen itself has no subscription dependency', () => {
    const walkScreen = fs.readFileSync(path.join(ROOT, 'app', 'walk.tsx'), 'utf8');
    expect(walkScreen).not.toMatch(/useSubscription|hasFullAccess|\bisPro\b|\/paywall/);
  });

  test('manual completion exempts walk entries from the activity-plan gate', () => {
    const activityScreen = fs.readFileSync(
      path.join(ROOT, 'app', '(tabs)', 'activity.tsx'),
      'utf8',
    );
    expect(activityScreen).toContain(
      "if (!hasFullAccess && item.activity_type !== 'walk')",
    );
  });
});
