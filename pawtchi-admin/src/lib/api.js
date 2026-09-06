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

// ── Creator codes ───────────────────────────────────────────────────────────
//
// The whole management surface for the creator programme. Onboarding a creator
// is a row, a comp, and nothing else — no App Store Connect, no Play Console,
// no build. Everything below is admin-gated in the database (`is_admin()`), not
// here: this bundle ships the anon key, so hiding a button is not access
// control.

/** Every code with its redemption and conversion counts. */
export async function fetchCreatorCodes() {
  const { data, error } = await supabase.rpc('get_creator_code_stats');
  if (error) throw translateCreator(error);
  return (data ?? []).map((r) => ({
    code: r.code,
    creatorName: r.creator_name,
    creatorHandle: r.creator_handle,
    creatorOwnerId: r.creator_owner_id,
    creatorEmail: r.creator_email,
    isActive: r.is_active,
    duration: r.duration,
    maxRedemptions: r.max_redemptions,
    expiresAt: r.expires_at,
    compExpiresAt: r.comp_expires_at,
    redemptionsGranted: r.redemptions_granted,
    redemptionsFailed: r.redemptions_failed,
    convertedToPaid: r.converted_to_paid,
    createdAt: r.created_at,
  }));
}

/**
 * Resolve a creator's email to their account id.
 *
 * Returns null when there is no such account, which is a normal state rather
 * than an error: deals get agreed before the creator has signed up, and the
 * code can be created unlinked and linked later.
 */
export async function findUserIdByEmail(email) {
  const { data, error } = await supabase.rpc('find_user_id_by_email', { p_email: email });
  if (error) throw translateCreator(error);
  return data ?? null;
}

export async function createCreatorCode({
  code,
  creatorName,
  creatorHandle,
  creatorOwnerId,
  duration,
  maxRedemptions,
  expiresAt,
  note,
}) {
  const { error } = await supabase.from('creator_codes').insert({
    // Uppercased here so the CHECK constraint's message never reaches a human.
    // The database normalises on read; this is about the write not failing on a
    // lowercase code somebody typed.
    code: (code ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase(),
    creator_name: creatorName,
    creator_handle: creatorHandle || null,
    creator_owner_id: creatorOwnerId || null,
    duration: duration || 'three_month',
    max_redemptions: maxRedemptions ? Number(maxRedemptions) : null,
    expires_at: expiresAt || null,
    note: note || null,
  });
  if (error) throw translateCreator(error);
}

export async function setCreatorCodeActive(code, isActive) {
  const { error } = await supabase
    .from('creator_codes')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('code', code);
  if (error) throw translateCreator(error);
}

/**
 * Gives the creator their own year of Plus.
 *
 * A creator cannot make content about features they cannot see, so this is a
 * precondition of the collaboration rather than a courtesy. It writes to
 * creator_codes.comp_*, never to the redemptions table — a comp counted as a
 * redemption would put every creator inside their own conversion numbers.
 */
export async function grantCreatorComp(code) {
  const { data, error } = await supabase.functions.invoke('grant-creator-comp', {
    body: { code },
  });
  if (error) throw new Error('The comp did not go through. Try again in a moment.');
  if (data?.reason === 'not_linked') {
    throw new Error(
      'This code has no Pawtchi account linked to it yet. Add their email to the code first.',
    );
  }
  if (!data?.success) throw new Error('The comp did not go through. Try again in a moment.');
  return data.expires_at ?? null;
}

function translateCreator(error) {
  const msg = error?.message ?? '';
  if (msg.includes('forbidden')) {
    return new Error('Your account is not on the admin list any more. Sign out and back in.');
  }
  if (msg.includes('creator_codes_pkey') || msg.includes('duplicate key')) {
    return new Error('That code already exists. Codes are unique across every creator.');
  }
  if (msg.includes('creator_codes_code_check')) {
    return new Error('Codes are 3 to 24 letters and digits. No spaces or punctuation.');
  }
  if (msg.includes('creator_codes_creator_owner_id_key')) {
    return new Error('That account already has a code. One code per creator.');
  }
  return new Error('That did not save. Nothing was lost — try again in a moment.');
}
