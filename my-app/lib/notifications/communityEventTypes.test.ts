/**
 * The community event-type list exists twice: as a CHECK constraint in SQL and
 * as a TypeScript union in the dispatcher.
 *
 * Like the Live Activity's duplicated Swift struct, the duplication is forced —
 * the dispatcher is a Deno binary that never imports from this repo's SQL — and
 * like it, the failure is silent rather than loud. The database accepts the new
 * type, the trigger enqueues happily, and the row simply sits in
 * `community_notification_events` for ever because the pass that would deliver
 * it does not recognise its shape. Nothing errors. Nobody is told.
 *
 * Production has already demonstrated the cost of exactly this class of gap: 79
 * community events were enqueued over five days and not one was delivered,
 * because the deployed dispatcher had no community pass at all.
 *
 * So: the two lists must be identical, and this test is what says so.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');

const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const DISPATCHER = path.join(
  ROOT,
  'supabase',
  'functions',
  'notify-dispatch',
  'index.ts',
);

/**
 * The event types the database will accept, read from the LAST migration that
 * redefines the constraint.
 *
 * Migrations are applied in filename order and this constraint is dropped and
 * recreated wholesale each time, so the final definition wins — exactly as
 * Postgres sees it.
 */
function typesAllowedBySql(): string[] {
  const files = fs
    .readdirSync(MIGRATIONS)
    .filter(name => name.endsWith('.sql'))
    .sort();

  let latest: string | null = null;
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
    // Both the original table definition and any later ADD CONSTRAINT.
    const matches = sql.match(
      /event_type TEXT NOT NULL CHECK \(event_type IN \(([^)]*)\)\)|community_notification_events_event_type_check\s*\n?\s*CHECK \(event_type IN \(([\s\S]*?)\)\)/g,
    );
    if (matches?.length) latest = matches[matches.length - 1];
  }

  if (!latest) throw new Error('No community event_type CHECK found in any migration');
  return [...latest.matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort();
}

/** The event types the dispatcher's union will relay. */
function typesAllowedByDispatcher(): string[] {
  const source = fs.readFileSync(DISPATCHER, 'utf8');
  const block = source.match(
    /event_type:\s*([\s\S]*?);\n\s*title: string;/,
  );
  if (!block) throw new Error('Could not find event_type union in notify-dispatch');
  return [...block[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort();
}

describe('community notification event types', () => {
  it('are the same set in SQL and in the dispatcher', () => {
    expect(typesAllowedByDispatcher()).toEqual(typesAllowedBySql());
  });

  it('include every kind the Together screens can produce', () => {
    // Named explicitly rather than derived, so deleting a producer without
    // deciding to is caught here rather than noticed by a host who stopped
    // hearing about their own walks.
    const sql = typesAllowedBySql();
    for (const required of [
      'community_invite',
      'community_walk_change',
      'community_memory_ready',
      'community_rsvp',
      'community_moment',
      'community_walk_soon',
      'community_join_request',
      'community_join_approved',
    ]) {
      expect(sql).toContain(required);
    }
  });

  it('are all produced by something', () => {
    // A type the database accepts but nothing ever writes is dead weight that
    // reads like a feature.
    //
    // "Produced" means named OUTSIDE a CHECK list, so the constraint declaring
    // a type does not count as evidence that anything enqueues it. The CHECK
    // blocks are removed from the source first rather than pattern-matched
    // around: an earlier version of this test tried to out-count the two uses
    // with a regex and was simply wrong about which matches were which.
    const withoutConstraints = fs
      .readdirSync(MIGRATIONS)
      .filter(name => name.endsWith('.sql'))
      .map(name => fs.readFileSync(path.join(MIGRATIONS, name), 'utf8'))
      .join('\n')
      .replace(/CHECK \(event_type IN \([\s\S]*?\)\)/g, '');

    for (const type of typesAllowedBySql()) {
      expect(withoutConstraints).toContain(`'${type}'`);
    }
  });
});
