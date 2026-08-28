# Pawtchi Admin

Answers support requests and founder letters. Intended for `admin.pawtchi.com`.

## What it is

A static Vite SPA. It ships the **anon key only** — there is no server, no
serverless function, and no service key anywhere in this project.

That is deliberate, and it is the thing to understand before changing anything:
a static bundle is readable by anyone who opens devtools, so this app has no
special power of its own. What an admin can see and do is decided entirely by
RLS and the `admin_users` allowlist in the database.

Hiding the route, or checking a flag in React, is **not** access control —
anyone can call PostgREST directly with the same key.

## Granting access

Nobody is an admin by default. The allowlist ships empty, so `is_admin()` is
false for every account and every screen shows "not on the admin list".

Grant from the Supabase SQL editor (service role only):

```sql
INSERT INTO admin_users (user_id, note)
SELECT id, 'why this person'
FROM auth.users WHERE email = 'the@address.com'
ON CONFLICT (user_id) DO NOTHING;
```

Revoke:

```sql
DELETE FROM admin_users
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'the@address.com');
```

`admin_users` has RLS on with no policies, so this can only be run with the
service role. An admin cannot promote anyone, including themselves.

The account must exist in Supabase Auth first. The cleanest way to create a
dedicated one is Dashboard → Authentication → Users → **Add user**, rather than
signing up through the app — that avoids attaching a pet profile and logs to
what is only meant to be an admin identity.

## Local

```bash
cp .env.example .env
npm install
npm run dev
```

## Deploy

```bash
npx vercel --prod
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the Vercel project
(values in `.env.example`), then point `admin.pawtchi.com` at it.

Deploy it under the same Vercel account as `pawtchi-website`, so the domain and
the site live together.

`vercel.json` already sets `noindex`, `DENY` framing, `nosniff` and
`no-referrer` — the last one matters because a referrer would otherwise leak
ticket ids to any external link opened from a thread.

## How replies reach people

Replies are written through `admin_reply_to_ticket` / `admin_reply_to_letter`
rather than a raw insert, so writing the reply and marking the ticket answered
happen in one statement. Done separately, a crash between them leaves a reply
that is sent but still reads as open, and it gets answered twice.

Both leave `push_sent_at` NULL. `notify-dispatch` runs every 15 minutes, picks
up anything unsent, pushes it, and only then stamps the row — so a failed send
leaves the reply queued rather than silently swallowing it.

## The two channels are not the same thing

Support tickets and founder letters share a queue for ordering and nothing
else. They carry different promises and want different replies:

|              | Support                  | Letters                      |
| ------------ | ------------------------ | ---------------------------- |
| Signed       | the Pawtchi team         | unsigned — a person, not a name |
| Attached     | full diagnostics         | nothing about the animal     |
| Replies      | as many as needed        | one, enforced by a unique index |
| Promise      | within 2 business days   | "we reply to as many as we can" |

A letter answered in a support voice is worse than no reply. Keep them distinct.
