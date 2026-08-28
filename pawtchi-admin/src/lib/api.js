import { supabase } from './supabase';

// Every query the panel makes, in one place.
//
// Support tickets and founder letters are two different channels with two
// different promises, and the app goes to real lengths to keep them apart. They
// are normalised into one shape here ONLY so a single queue can be sorted by
// age — `kind` is carried through so the UI can keep them visually distinct and
// so a reply is never written to the wrong table.

export async function isAdmin() {
  const { data, error } = await supabase.rpc('is_admin');
  if (error) return false;
  return data === true;
}

/** Resolve owner ids → emails. Admin-gated inside the function. */
async function emailsFor(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return {};
  const { data, error } = await supabase.rpc('admin_emails_for', { p_ids: unique });
  if (error) return {};
  return Object.fromEntries((data ?? []).map((r) => [r.user_id, r.email]));
}

/**
 * The whole queue, oldest first.
 *
 * Oldest-first is the queue discipline, not a default: newest-first means the
 * request that has been waiting longest is the one you scroll past, which is
 * exactly how a two-business-day promise quietly stops being true.
 */
export async function fetchQueue() {
  const [ticketsRes, lettersRes] = await Promise.all([
    supabase
      .from('support_tickets')
      .select(
        'id, topic, area, body, status, created_at, owner_id, attachment_path, diagnostics, support_ticket_replies(id, body, created_at, read_at)',
      )
      .order('created_at', { ascending: true }),
    supabase
      .from('founder_letters')
      .select(
        'id, body, entry_source, created_at, owner_id, app_version, founder_letter_replies(id, body, created_at, read_at)',
      )
      .order('created_at', { ascending: true }),
  ]);

  if (ticketsRes.error) throw ticketsRes.error;
  if (lettersRes.error) throw lettersRes.error;

  const tickets = ticketsRes.data ?? [];
  const letters = lettersRes.data ?? [];

  const emails = await emailsFor([
    ...tickets.map((t) => t.owner_id),
    ...letters.map((l) => l.owner_id),
  ]);

  const items = [
    ...tickets.map((t) => ({
      kind: 'ticket',
      id: t.id,
      topic: t.topic,
      area: t.area,
      body: t.body,
      status: t.status,
      createdAt: t.created_at,
      email: emails[t.owner_id] ?? null,
      attachmentPath: t.attachment_path,
      diagnostics: t.diagnostics ?? null,
      replies: sortReplies(t.support_ticket_replies),
      entrySource: null,
    })),
    ...letters.map((l) => ({
      kind: 'letter',
      id: l.id,
      topic: 'letter',
      area: null,
      body: l.body,
      // Letters carry no status column; answered is simply "has a reply".
      status: (l.founder_letter_replies ?? []).length > 0 ? 'answered' : 'open',
      createdAt: l.created_at,
      email: emails[l.owner_id] ?? null,
      attachmentPath: null,
      diagnostics: l.app_version ? { app_version: l.app_version } : null,
      replies: sortReplies(l.founder_letter_replies),
      entrySource: l.entry_source,
    })),
  ];

  items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return items;
}

function sortReplies(rows) {
  return (rows ?? [])
    .map((r) => ({ id: r.id, body: r.body, createdAt: r.created_at, readAt: r.read_at }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** One item by kind + id. Reuses fetchQueue so there is one shape to maintain. */
export async function fetchItem(kind, id) {
  const all = await fetchQueue();
  return all.find((i) => i.kind === kind && i.id === id) ?? null;
}

/**
 * Send a reply.
 *
 * Routed through the RPCs rather than a raw insert so the write and the status
 * change are one statement — a reply that is sent but still reads as open gets
 * answered twice. The RPCs re-check admin status themselves; a SECURITY DEFINER
 * function is its own trust boundary and should not assume the caller arrived
 * through a policy.
 *
 * `push_sent_at` is deliberately left NULL: that is what makes notify-dispatch
 * pick the reply up and deliver it on its next run.
 */
export async function sendReply(kind, id, body) {
  const fn = kind === 'ticket' ? 'admin_reply_to_ticket' : 'admin_reply_to_letter';
  const args =
    kind === 'ticket'
      ? { p_ticket_id: id, p_body: body }
      : { p_letter_id: id, p_body: body };

  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw translate(error);
  return data;
}

/** Turn a Postgres exception into something a human should read. */
function translate(error) {
  const msg = error?.message ?? '';
  if (msg.includes('already_replied')) {
    return new Error(
      'This letter already has a reply. Letters are limited to one reply on purpose, so there is nothing more to send here.',
    );
  }
  if (msg.includes('forbidden')) {
    return new Error('Your account is not on the admin list any more. Sign out and back in.');
  }
  if (msg.includes('empty_body')) return new Error('The reply is empty.');
  if (msg.includes('not_found')) return new Error('That item no longer exists.');
  return new Error('The reply did not send. Nothing was lost — try again in a moment.');
}

/**
 * A short-lived link to a screenshot. The bucket is private, so this is the
 * only way to view one, and the URL expires rather than becoming a permanent
 * unauthenticated handle on someone's screen contents.
 */
export async function signedAttachmentUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from('support-attachments')
    .createSignedUrl(path, 300);
  if (error) return null;
  return data?.signedUrl ?? null;
}
