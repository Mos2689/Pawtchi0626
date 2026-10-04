// Local check for SQL migrations and pgTAP files, without Docker or a branch:
// a Supabase-shaped stub schema in PGlite (Postgres 17 compiled to WASM), the
// production live-location policies as they stood before 20261004000000, then
// the migrations given, then the pgTAP files through a small TAP shim
// (plan / is / ok / throws_ok with 4 arguments / lives_ok / finish).
//
// It is a fast first gate, not the release gate: no Realtime, no PostgREST, a
// single connection (so no concurrency), and only the tables the live-walk
// tests touch. The release gate is the same .test.sql on a Supabase branch.
//
// PGlite is not a project dependency. Install it in a scratch folder and run
// from there:
//
//   mkdir -p /tmp/pglite && cd /tmp/pglite && npm init -y && npm i @electric-sql/pglite@0.5.8
//   node <repo>/supabase/tests/local/pglite-harness.mjs //     <repo>/supabase/migrations/20261004000000_live_walk_privacy_and_rpc.sql //     <repo>/supabase/tests/live_walk_v2.test.sql
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const requireFromCwd = createRequire(pathToFileURL(`${process.cwd()}/`).href);
const { PGlite } = await import(pathToFileURL(requireFromCwd.resolve('@electric-sql/pglite')).href);

const [, , ...files] = process.argv;
const tests = files.filter(f => f.endsWith('.test.sql'));
const migrations = files.filter(f => !f.endsWith('.test.sql'));

const bootstrap = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT anon, authenticated, service_role TO postgres;

CREATE SCHEMA auth;
CREATE TABLE auth.users (id UUID PRIMARY KEY, email TEXT);
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;

CREATE SCHEMA private;
GRANT USAGE ON SCHEMA private TO authenticated;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TABLE public.community_packs (
  id UUID PRIMARY KEY, name TEXT NOT NULL, owner_id UUID NOT NULL REFERENCES auth.users(id));
CREATE TABLE public.community_pack_members (
  pack_id UUID NOT NULL REFERENCES public.community_packs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  archive_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  notifications_muted BOOLEAN NOT NULL DEFAULT false,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (pack_id, user_id));
CREATE TABLE public.community_walks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id UUID NOT NULL REFERENCES public.community_packs(id) ON DELETE CASCADE,
  organizer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  title TEXT NOT NULL DEFAULT 'Pack walk',
  scheduled_for TIMESTAMPTZ,
  meeting_label TEXT NOT NULL,
  meeting_lat DOUBLE PRECISION, meeting_lng DOUBLE PRECISION, note TEXT,
  state TEXT NOT NULL DEFAULT 'planned' CHECK (state IN ('planned', 'active', 'completed', 'cancelled')),
  started_at TIMESTAMPTZ, ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE public.community_walk_attendance (
  walk_id UUID NOT NULL REFERENCES public.community_walks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'invited'
    CHECK (status IN ('invited', 'coming', 'cant_make_it', 'checked_in', 'walking', 'finished')),
  share_location BOOLEAN NOT NULL DEFAULT false,
  checked_in_at TIMESTAMPTZ, joined_at TIMESTAMPTZ, finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (walk_id, user_id));
CREATE TABLE public.community_live_locations (
  walk_id UUID NOT NULL REFERENCES public.community_walks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lat DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  accuracy_m DOUBLE PRECISION CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
  path JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(path) = 'array' AND jsonb_array_length(path) <= 200),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (walk_id, user_id));
CREATE TABLE public.community_stale_walk_watch (
  walk_id UUID PRIMARY KEY REFERENCES public.community_walks(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ, last_activity_at TIMESTAMPTZ NOT NULL,
  first_flagged_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_flagged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  times_flagged INTEGER NOT NULL DEFAULT 1, resolved_at TIMESTAMPTZ);

CREATE FUNCTION public.is_community_pack_member(p_pack_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.community_pack_members WHERE pack_id = p_pack_id AND user_id = p_user_id) $$;
CREATE FUNCTION public.can_access_community_walk(p_walk_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.community_walks w JOIN public.community_pack_members m ON m.pack_id = w.pack_id
                  WHERE w.id = p_walk_id AND m.user_id = p_user_id) $$;

ALTER TABLE public.community_walks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_walk_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_live_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_pack_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_packs ENABLE ROW LEVEL SECURITY;

CREATE POLICY community_walks_read_members ON public.community_walks FOR SELECT TO authenticated
  USING (public.is_community_pack_member(pack_id, (select auth.uid())));
CREATE POLICY community_attendance_read_pack ON public.community_walk_attendance FOR SELECT TO authenticated
  USING (public.can_access_community_walk(walk_id, (select auth.uid())));

-- Production's live-location policies, verbatim (the unqualified walk_id bug).
CREATE POLICY community_locations_read_attendees ON public.community_live_locations
  FOR SELECT TO authenticated
  USING (
    public.can_access_community_walk(walk_id, (select auth.uid())) AND
    EXISTS (
      SELECT 1 FROM public.community_walks w
      JOIN public.community_walk_attendance a ON a.walk_id = w.id
      WHERE w.id = walk_id
        AND w.state = 'active'
        AND a.user_id = (select auth.uid())
        AND a.status IN ('coming', 'checked_in', 'walking', 'finished')
    )
  );
CREATE POLICY community_locations_write_self ON public.community_live_locations
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (select auth.uid()) AND
    public.can_access_community_walk(walk_id, (select auth.uid())) AND
    EXISTS (
      SELECT 1 FROM public.community_walk_attendance a
      JOIN public.community_walks w ON w.id = a.walk_id
      WHERE a.walk_id = walk_id AND a.user_id = (select auth.uid())
        AND a.status = 'walking' AND a.share_location AND w.state = 'active'
    )
  );
CREATE POLICY community_locations_update_self ON public.community_live_locations
  FOR UPDATE TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (
    user_id = (select auth.uid()) AND
    public.can_access_community_walk(walk_id, (select auth.uid())) AND
    EXISTS (
      SELECT 1 FROM public.community_walk_attendance a
      JOIN public.community_walks w ON w.id = a.walk_id
      WHERE a.walk_id = walk_id AND a.user_id = (select auth.uid())
        AND a.status = 'walking' AND a.share_location AND w.state = 'active'
    )
  );
`;

// A minimal pgTAP: plan / is / ok / throws_ok (4 args) / lives_ok / finish.
const tap = `
CREATE TABLE public._tap (n SERIAL, ok BOOLEAN, description TEXT);
CREATE TABLE public._tap_plan (planned INT);
REVOKE ALL ON public._tap, public._tap_plan FROM anon, authenticated;
CREATE FUNCTION public._tap_record(p_ok BOOLEAN, p_desc TEXT, p_diag TEXT DEFAULT NULL) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_n INT;
BEGIN
  INSERT INTO public._tap (ok, description) VALUES (p_ok, p_desc) RETURNING n INTO v_n;
  RETURN (CASE WHEN p_ok THEN 'ok ' ELSE 'not ok ' END) || v_n || ' - ' || p_desc
         || CASE WHEN p_ok OR p_diag IS NULL THEN '' ELSE E'\\n#   ' || p_diag END;
END $$;
CREATE FUNCTION public.plan(p INT) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN INSERT INTO public._tap_plan VALUES (p); RETURN '1..' || p; END $$;
CREATE FUNCTION public.is(got ANYELEMENT, want ANYELEMENT, descr TEXT) RETURNS TEXT LANGUAGE sql AS $$
  SELECT public._tap_record(got IS NOT DISTINCT FROM want, descr,
    'got: ' || coalesce(got::TEXT, 'NULL') || ' want: ' || coalesce(want::TEXT, 'NULL')) $$;
CREATE FUNCTION public.ok(cond BOOLEAN, descr TEXT) RETURNS TEXT LANGUAGE sql AS $$
  SELECT public._tap_record(coalesce(cond, false), descr) $$;
CREATE FUNCTION public.throws_ok(p_sql TEXT, p_code TEXT, p_msg TEXT, descr TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN public._tap_record(false, descr, 'no error raised');
EXCEPTION WHEN OTHERS THEN
  RETURN public._tap_record(
    (p_code IS NULL OR SQLSTATE = p_code) AND (p_msg IS NULL OR SQLERRM = p_msg),
    descr, 'raised ' || SQLSTATE || ': ' || SQLERRM);
END $$;
CREATE FUNCTION public.lives_ok(p_sql TEXT, descr TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN public._tap_record(true, descr);
EXCEPTION WHEN OTHERS THEN
  RETURN public._tap_record(false, descr, 'raised ' || SQLSTATE || ': ' || SQLERRM);
END $$;
CREATE FUNCTION public.finish() RETURNS SETOF TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_run INT; v_fail INT; v_plan INT;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE NOT ok) INTO v_run, v_fail FROM public._tap;
  SELECT planned INTO v_plan FROM public._tap_plan LIMIT 1;
  IF v_plan IS DISTINCT FROM v_run THEN RETURN NEXT '# planned ' || v_plan || ' but ran ' || v_run; END IF;
  RETURN NEXT '# ' || v_run || ' run, ' || v_fail || ' failed';
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;
`;

const db = await PGlite.create();
await db.exec(bootstrap);
await db.exec(tap);

for (const file of migrations) {
  try {
    await db.exec(readFileSync(file, 'utf8'));
    console.log(`# applied ${file.split(/[\\/]/).pop()}`);
  } catch (e) {
    console.log(`Bail out! migration ${file}: ${e.message}`);
    process.exit(1);
  }
}

let failed = false;
for (const file of tests) {
  console.log(`# ${file.split(/[\\/]/).pop()}`);
  let results;
  try {
    results = await db.exec(readFileSync(file, 'utf8'));
  } catch (e) {
    console.log(`Bail out! ${e.message}`);
    process.exit(1);
  }
  for (const r of results) {
    for (const row of r.rows ?? []) {
      for (const value of Object.values(row)) {
        if (typeof value === 'string' && /^(ok|not ok|#|1\.\.)/.test(value)) {
          console.log(value);
          if (value.startsWith('not ok') || /failed$/.test(value) && !/ 0 failed$/.test(value) || value.startsWith('# planned')) failed = true;
        }
      }
    }
  }
}
process.exit(failed ? 1 : 0);
