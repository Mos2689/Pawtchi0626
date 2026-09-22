/**
 * Checks that each rollback script actually undoes its migration.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * A teardown is written once, at the moment the migration is fresh, and read
 * months later on the worst day of the release. Between those two moments the
 * migration usually gains a table or a function, and the teardown usually does
 * not. Nothing notices, because of the specific way these scripts fail:
 *
 *   DROP TABLE IF EXISTS public.community_pakcs CASCADE;
 *
 * That is a typo. It raises nothing, reverts nothing, and reports success. So
 * does a table added to the migration and never added to the teardown. A
 * rollback nobody checks is a rollback that quietly stops being one — the same
 * reasoning as scripts/check-schema-drift.js and sync-notification-shared.js.
 *
 * This compares the two files as sets of object names, in both directions:
 *
 *   created but not dropped  → the teardown leaves something behind
 *   dropped but not created  → a typo, or an object that has been renamed
 *
 * It is pure text analysis. It needs no database and no credentials, so it can
 * run in CI and on a laptop that has never seen production.
 *
 *   node scripts/check-rollback-coverage.js
 *
 * Migrations with no rollback at all are listed, not failed. Most of this
 * project's history predates the convention, and retrofitting teardowns for
 * migrations already long applied is not worth anyone's afternoon.
 */

const fs = require('fs');
const path = require('path');

const MIGRATIONS = path.join(__dirname, '..', 'supabase', 'migrations');
const ROLLBACKS = path.join(__dirname, '..', 'supabase', 'rollback');

/**
 * Section 2 of a teardown — the part that destroys user data — ships commented
 * out on purpose. Counting those lines as coverage would be a lie in the
 * reassuring direction, so everything after the marker is discarded.
 */
const DESTRUCTIVE_MARKER = /^-- SECTION 2\b/m;

function activeSql(text) {
  const cut = text.search(DESTRUCTIVE_MARKER);
  return cut === -1 ? text : text.slice(0, cut);
}

/** Object names a migration brings into existence. */
function created(sql) {
  return {
    table: new Set([...sql.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+public\.(\w+)/gi)].map(m => m[1])),
    function: new Set([...sql.matchAll(/CREATE(?:\s+OR REPLACE)?\s+FUNCTION\s+public\.(\w+)\s*\(/gi)].map(m => m[1])),
    // Only policies placed on tables the migration did NOT create: a policy on
    // its own table disappears with the table and needs no teardown line.
    policy: new Set(),
  };
}

/**
 * Object names a teardown puts back rather than removes.
 *
 * A migration that replaces an existing function is undone by replacing it
 * again with its previous body — not by dropping it, which would delete
 * something the migration never introduced. Restoration is coverage.
 */
function restored(sql) {
  return new Set(
    [...sql.matchAll(/CREATE(?:\s+OR REPLACE)?\s+FUNCTION\s+public\.(\w+)\s*\(/gi)].map(m => m[1]),
  );
}

/** Object names a teardown removes. */
function dropped(sql) {
  return {
    table: new Set([...sql.matchAll(/DROP TABLE(?:\s+IF EXISTS)?\s+public\.(\w+)/gi)].map(m => m[1])),
    function: new Set([...sql.matchAll(/DROP FUNCTION(?:\s+IF EXISTS)?\s+public\.(\w+)\s*\(/gi)].map(m => m[1])),
    policy: new Set([...sql.matchAll(/DROP POLICY(?:\s+IF EXISTS)?\s+(\w+)\s+ON/gi)].map(m => m[1])),
  };
}

/**
 * Policies on pre-existing tables, which are the ones that outlive a teardown
 * if forgotten. A policy on a table this same migration creates is excluded —
 * dropping the table takes it along.
 */
function foreignPolicies(sql, ownTables) {
  const found = new Set();
  for (const m of sql.matchAll(/CREATE POLICY\s+(\w+)\s+ON\s+(?:(\w+)\.)?(\w+)/gi)) {
    const [, name, schema, table] = m;
    const ownedHere = (schema === undefined || schema === 'public') && ownTables.has(table);
    if (!ownedHere) found.add(name);
  }
  return found;
}

function main() {
  if (!fs.existsSync(ROLLBACKS)) {
    console.log('[rollback-coverage] no supabase/rollback directory — nothing to check.');
    return 0;
  }

  const migrations = fs.readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort();
  const problems = [];
  const unpaired = [];
  let checked = 0;

  for (const file of migrations) {
    const stem = file.replace(/\.sql$/, '');
    const rollbackPath = path.join(ROLLBACKS, `${stem}_down.sql`);
    if (!fs.existsSync(rollbackPath)) {
      unpaired.push(file);
      continue;
    }

    checked += 1;
    const migSql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
    const downSql = activeSql(fs.readFileSync(rollbackPath, 'utf8'));

    const make = created(migSql);
    make.policy = foreignPolicies(migSql, make.table);
    const undo = dropped(downSql);
    const putBack = restored(downSql);

    for (const kind of ['table', 'function', 'policy']) {
      for (const name of [...make[kind]].sort()) {
        const covered = undo[kind].has(name) || (kind === 'function' && putBack.has(name));
        if (!covered) {
          problems.push(`${stem}: ${kind} "${name}" is created but never dropped or restored`);
        }
      }
      for (const name of [...undo[kind]].sort()) {
        if (!make[kind].has(name)) {
          problems.push(`${stem}: ${kind} "${name}" is dropped but never created — typo?`);
        }
      }
    }
  }

  if (unpaired.length) {
    console.log(`[rollback-coverage] ${unpaired.length} migration(s) without a rollback (not an error):`);
    for (const file of unpaired) console.log(`    ${file}`);
    console.log('');
  }

  if (problems.length) {
    console.error(`[rollback-coverage] FAILED — ${problems.length} gap(s):`);
    for (const problem of problems) console.error(`    ${problem}`);
    console.error('\nA teardown with a gap reports success and reverts nothing.');
    return 1;
  }

  console.log(`[rollback-coverage] OK — ${checked} rollback script(s) fully cover their migration.`);
  return 0;
}

process.exit(main());
