import { createClient } from '@supabase/supabase-js';

// The ANON key, and only ever the anon key.
//
// This is a static bundle: everything in it is readable by anyone who opens
// devtools. That is fine for the anon key — it is designed to be public and is
// already shipped inside the mobile app — and would be a full database
// compromise for the service_role key.
//
// So this client has no special power. What an admin can read and write is
// decided entirely by RLS plus the `admin_users` allowlist in the database. If
// this file leaked verbatim, a stranger would still see nothing.

// Defaults rather than required env vars, because these two are public by
// construction: the anon key is designed to be shipped to clients and is
// already inside the mobile app bundle, so committing it here exposes nothing
// that was not already public. Making them required would mean a deploy with
// no env vars set builds fine and then white-screens at runtime, which is a
// worse failure than a value in the repo.
//
// Both are still overridable, so pointing this at a staging project is a
// Vercel env var away.
const DEFAULT_URL = 'https://mbvpjbwukhypvmgeuyyw.supabase.co';
const DEFAULT_ANON_KEY = 'sb_publishable_fpBRIqLHJQoKydS0tMyzwg_hINKYOQ_';

const url = import.meta.env.VITE_SUPABASE_URL || DEFAULT_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_ANON_KEY;

// Fail loudly rather than shipping a service key by accident. A service_role
// JWT carries `"role":"service_role"`; the newer `sb_secret_` keys are prefixed.
// This has caught the mistake in enough codebases to be worth four lines.
if (anonKey.startsWith('sb_secret_') || anonKey.includes('service_role')) {
  throw new Error(
    'A service_role key is set as VITE_SUPABASE_ANON_KEY. Never put a service key in a browser bundle.',
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // No magic-link/OAuth callbacks in this tool, so there is no fragment to parse.
    detectSessionInUrl: false,
  },
});
