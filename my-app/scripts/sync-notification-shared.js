/**
 * Mirrors lib/notifications/* and lib/email/* into
 * supabase/functions/_shared/{notifications,email}/*.
 *
 * The August 2026 notification audit found the live dispatcher was a fork of
 * the app's rule engine that existed only in the Supabase dashboard. It drifted
 * until it was pushing a developer test string ("Testing, testing! 1, 2, 3
 * Dad!") to real owners for four months. One source of truth, mechanically
 * copied, is the fix.
 *
 * The email engine is mirrored by the same mechanism for the same reason: a
 * second channel is a second chance to make that mistake. The two mirror
 * directories are siblings under _shared/ precisely so that a relative import
 * across them (lib/email/copy.ts imports ../notifications/copy) resolves
 * identically in both runtimes.
 *
 * The only edit made in transit is import specifiers: Deno requires the `.ts`
 * extension on relative imports, the Expo/TypeScript build forbids it. Both
 * this script and the tests call the same `toDenoSource`, so a test can assert
 * the checked-in mirror is exactly what this script would write.
 *
 *   node scripts/sync-notification-shared.js          # write the mirror
 *   node scripts/sync-notification-shared.js --check  # fail if out of date
 */

const fs = require('fs');
const path = require('path');

const root = (...parts) => path.join(__dirname, '..', ...parts);

/**
 * Each group is one app directory mirrored into one edge directory. Adding a
 * group is the only thing needed to bring a new shared module under the drift
 * check — both the sync and the test iterate this list.
 */
const MIRROR_GROUPS = [
  {
    name: 'notifications',
    appDir: root('lib', 'notifications'),
    edgeDir: root('supabase', 'functions', '_shared', 'notifications'),
    files: ['copy.ts', 'rules.ts', 'walkInsights.ts'],
  },
  {
    name: 'email',
    appDir: root('lib', 'email'),
    edgeDir: root('supabase', 'functions', '_shared', 'email'),
    files: ['copy.ts', 'rules.ts', 'template.ts', 'compositions.ts'],
  },
];

// Retained so the existing copy.test.ts mirror assertions keep working
// unchanged. New tests should iterate MIRROR_GROUPS instead.
const MIRRORED_FILES = MIRROR_GROUPS[0].files;
const APP_DIR = MIRROR_GROUPS[0].appDir;
const EDGE_DIR = MIRROR_GROUPS[0].edgeDir;

/** Rewrites relative imports to the explicit `.ts` form Deno needs. */
function toDenoSource(source) {
  return source.replace(
    /(from\s+['"])(\.\.?\/[^'"]+?)(['"])/g,
    (match, open, spec, close) =>
      spec.endsWith('.ts') || spec.endsWith('.json') ? match : `${open}${spec}.ts${close}`,
  );
}

function run({ check }) {
  const stale = [];

  for (const group of MIRROR_GROUPS) {
    fs.mkdirSync(group.edgeDir, { recursive: true });

    for (const file of group.files) {
      const expected = toDenoSource(fs.readFileSync(path.join(group.appDir, file), 'utf8'));
      const target = path.join(group.edgeDir, file);
      const actual = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;

      if (actual === expected) continue;
      if (check) {
        stale.push(`${group.name}/${file}`);
        continue;
      }
      fs.writeFileSync(target, expected);
      process.stdout.write(`synced ${group.name}/${file}\n`);
    }
  }

  if (stale.length > 0) {
    process.stderr.write(
      `Shared mirror is out of date: ${stale.join(', ')}\n` +
        'Run: node scripts/sync-notification-shared.js\n',
    );
    process.exitCode = 1;
  }
}

if (require.main === module) {
  run({ check: process.argv.includes('--check') });
}

module.exports = { toDenoSource, MIRROR_GROUPS, MIRRORED_FILES, APP_DIR, EDGE_DIR };
