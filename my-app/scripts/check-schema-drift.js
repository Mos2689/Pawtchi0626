/**
 * Compares the live database's column layout against a checked-in manifest.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * `food_scans.pantry_item_id` has existed in production for months. It appears
 * in no migration and in no version of schema.sql. Nobody noticed, because
 * nothing ever compared the two — so an environment built from this repo has a
 * different `food_scans` to the one the app actually talks to, and a migration
 * written against the repo's idea of the schema can fail or, worse, succeed
 * against the wrong assumptions.
 *
 * `supabase/schema.sql` cannot serve as the source of truth here: it does not
 * describe `food_pantry` at all. It is a partial historical document. This
 * manifest is generated FROM the database, which is the only thing that is
 * definitionally correct about the database.
 *
 * Same shape as scripts/sync-notification-shared.js, for the same reason — a
 * mirror nobody checks is a mirror that drifts.
 *
 *   node scripts/check-schema-drift.js          # fail if the DB and manifest differ
 *   node scripts/check-schema-drift.js --write   # refresh the manifest from the DB
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Without them the check
 * SKIPS rather than fails: a developer without production credentials should
 * not be blocked, but CI (which has them) will catch the drift.
 */

const fs = require('fs');
const path = require('path');

const MANIFEST_PATH = path.join(__dirname, '..', 'supabase', 'schema-manifest.json');

/**
 * Tables under drift control.
 *
 * Deliberately scoped to the calorie pipeline rather than the whole database.
 * A manifest covering every table would need refreshing on every unrelated
 * migration, and a check that is noisy is a check that gets bypassed. Add a
 * table here when it starts carrying something a calculation depends on.
 */
const TRACKED_TABLES = [
  'pets',
  'food_scans',
  'food_pantry',
  'daily_logs',
  'weight_logs',
  'calorie_integrity_reports',
];

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return null;
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

function writeManifest(manifest) {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
}

async function fetchLiveManifest() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  const { createClient } = require('@supabase/supabase-js');
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await admin.rpc('schema_manifest', { p_tables: TRACKED_TABLES });
  if (error) throw new Error(`schema_manifest RPC failed: ${error.message}`);
  return data;
}

/** Column-level diff, so the output names the actual problem. */
function diff(expected, actual) {
  const problems = [];
  const tables = new Set([...Object.keys(expected), ...Object.keys(actual)]);

  for (const table of [...tables].sort()) {
    const want = expected[table];
    const have = actual[table];

    if (!want) { problems.push(`+ table ${table} exists in the database but not in the manifest`); continue; }
    if (!have) { problems.push(`- table ${table} is in the manifest but missing from the database`); continue; }

    const wantByName = new Map(want.map((c) => [c.name, c]));
    const haveByName = new Map(have.map((c) => [c.name, c]));

    for (const [name, col] of haveByName) {
      if (!wantByName.has(name)) {
        problems.push(`+ ${table}.${name} (${col.type}) exists in the database but not in the manifest`);
      }
    }
    for (const [name, col] of wantByName) {
      const found = haveByName.get(name);
      if (!found) {
        problems.push(`- ${table}.${name} (${col.type}) is in the manifest but missing from the database`);
        continue;
      }
      if (found.type !== col.type) {
        problems.push(`~ ${table}.${name} type ${col.type} -> ${found.type}`);
      }
      if (found.nullable !== col.nullable) {
        problems.push(`~ ${table}.${name} nullable ${col.nullable} -> ${found.nullable}`);
      }
    }
  }
  return problems;
}

async function main() {
  const write = process.argv.includes('--write');

  let live;
  try {
    live = await fetchLiveManifest();
  } catch (e) {
    console.error(`[schema-drift] ${e.message}`);
    process.exit(1);
  }

  if (!live) {
    console.log('[schema-drift] SKIPPED — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to run.');
    return;
  }

  if (write) {
    writeManifest(live);
    console.log(`[schema-drift] manifest written for ${Object.keys(live).length} table(s).`);
    return;
  }

  const expected = loadManifest();
  if (!expected) {
    console.error('[schema-drift] no manifest checked in. Run with --write.');
    process.exit(1);
  }

  const problems = diff(expected, live);
  if (problems.length === 0) {
    console.log(`[schema-drift] OK — ${Object.keys(expected).length} table(s) match.`);
    return;
  }

  console.error('[schema-drift] the database and the checked-in manifest disagree:\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    '\nIf the change was intentional, add a migration for it and refresh with --write.\n' +
    'If it was not, something changed production outside the migration history.',
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('[schema-drift] unexpected failure:', e);
  process.exit(1);
});
