#!/usr/bin/env node
// Create (and afterwards delete) throwaway accounts for live-walk-load.mjs.
//
// Needs the service-role key in the environment for this one command only —
// never put it in a file:
//
//   SUPABASE_SERVICE_ROLE_KEY=… node scripts/load/setup-test-accounts.mjs --create 25 --pack <meetup uuid>
//   SUPABASE_SERVICE_ROLE_KEY=… node scripts/load/setup-test-accounts.mjs --delete
//
// --create makes loadtest+01@example.com … with random passwords, confirms
// them, adds each to the load-test meetup as a member, and writes
// scripts/load/accounts.json (gitignored). --delete removes every account in
// that file; their meetup membership and walk rows go with them (cascade).
// Delete the same day: the accounts are real users to every campaign job.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const argv = process.argv.slice(2);
const arg = name => { const i = argv.indexOf(`--${name}`); return i === -1 ? undefined : (argv[i + 1] ?? 'true'); };
const FILE = arg('accounts') ?? 'scripts/load/accounts.json';
const DOMAIN = arg('domain') ?? 'example.com';

function env(name) {
  if (process.env[name]) return process.env[name];
  if (existsSync('.env')) {
    const line = readFileSync('.env', 'utf8').split(/\r?\n/).find(l => l.startsWith(name + '='));
    if (line) return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '');
  }
  return undefined;
}
const URL_ = env('EXPO_PUBLIC_SUPABASE_URL');
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !SERVICE) { console.error('Need EXPO_PUBLIC_SUPABASE_URL (.env) and SUPABASE_SERVICE_ROLE_KEY (environment).'); process.exit(2); }
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

if (arg('create')) {
  const n = Number(arg('create'));
  const pack = arg('pack');
  if (!pack) { console.error('--pack <meetup uuid> is required'); process.exit(2); }
  const { data: meetup } = await admin.from('community_packs').select('name').eq('id', pack).maybeSingle();
  if (!meetup || !/^load test/i.test(meetup.name)) {
    console.error(`Meetup ${pack} is missing or not named "Load test…" — refusing.`);
    process.exit(2);
  }
  const accounts = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : [];
  for (let i = accounts.length + 1; accounts.length < n; i += 1) {
    const email = `loadtest+${String(i).padStart(2, '0')}@${DOMAIN}`;
    const password = randomBytes(18).toString('base64url');
    const { data, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name: `Load test ${i}`, loadtest: true },
    });
    if (error) { console.error(`${email}: ${error.message}`); continue; }
    const { error: memberError } = await admin.from('community_pack_members')
      .insert({ pack_id: pack, user_id: data.user.id, role: 'member', archive_from: new Date().toISOString() });
    if (memberError) console.error(`${email}: membership — ${memberError.message}`);
    accounts.push({ email, password });
    process.stdout.write('.');
  }
  writeFileSync(FILE, JSON.stringify(accounts, null, 2));
  console.log(`\n${accounts.length} accounts in ${FILE}, all members of "${meetup.name}".`);
} else if (arg('delete')) {
  const accounts = JSON.parse(readFileSync(FILE, 'utf8'));
  const wanted = new Set(accounts.map(a => a.email.toLowerCase()));
  let page = 1, deleted = 0;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) { console.error(error.message); process.exit(1); }
    for (const user of data.users) {
      if (wanted.has((user.email ?? '').toLowerCase()) && user.user_metadata?.loadtest) {
        const { error: delError } = await admin.auth.admin.deleteUser(user.id);
        if (delError) console.error(`${user.email}: ${delError.message}`); else deleted += 1;
      }
    }
    if (data.users.length < 1000) break;
    page += 1;
  }
  writeFileSync(FILE, '[]');
  console.log(`Deleted ${deleted} test accounts.`);
} else {
  console.error('Use --create <n> --pack <uuid>, or --delete.');
  process.exit(2);
}
