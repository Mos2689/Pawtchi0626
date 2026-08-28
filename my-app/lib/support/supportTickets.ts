// Client helpers for Pawtchi Support.
//
// Thin wrappers over the support_tickets tables and their RPCs, modelled
// directly on lib/founderLetters.ts. There is no edge function here on purpose
// — nothing in this flow holds a secret or calls a vendor, so a SECURITY
// DEFINER RPC behind RLS is the whole server.
//
// The 5-per-24h cap lives in submit_support_ticket(); `remainingToday()` below
// is for display only and must never be treated as the enforcement point.

import { supabase } from '../supabase';
import { appError, toAppError, type AppError } from '../appError';
import type { SupportArea, SupportEntrySource, SupportTopic } from './copy';
import { SUPPORT_MAX_CHARS, TICKETS_PER_DAY } from './copy';
import type { SupportDiagnostics } from './diagnostics';

const ATTACHMENT_BUCKET = 'support-attachments';

export interface SupportReply {
  id: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export interface SupportTicket {
  id: string;
  topic: SupportTopic;
  area: SupportArea;
  body: string;
  createdAt: string;
  /**
   * Every reply, oldest first. v1 only ever writes one, but the schema has no
   * one-per-ticket index, so this is an array from the start — Phase 2 threads
   * become a rendering change rather than a type change here.
   */
  replies: SupportReply[];
}

interface TicketRow {
  id: string;
  topic: string;
  area: string;
  body: string;
  created_at: string;
  support_ticket_replies: {
    id: string;
    body: string;
    created_at: string;
    read_at: string | null;
  }[] | null;
}

function toTicket(row: TicketRow): SupportTicket {
  const replies = (row.support_ticket_replies ?? [])
    .map((r) => ({
      id: r.id,
      body: r.body,
      createdAt: r.created_at,
      readAt: r.read_at,
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return {
    id: row.id,
    topic: (row.topic === 'bug' ? 'bug' : 'question') as SupportTopic,
    area: row.area as SupportArea,
    body: row.body,
    createdAt: row.created_at,
    replies,
  };
}

const SELECT = 'id, topic, area, body, created_at, support_ticket_replies(id, body, created_at, read_at)';

/**
 * Every request this owner has opened, newest first, with any replies. RLS
 * scopes both tables to the caller, so no owner filter is needed.
 */
export async function listTickets(): Promise<SupportTicket[]> {
  const { data, error } = await supabase
    .from('support_tickets')
    .select(SELECT)
    .order('created_at', { ascending: false });

  if (error) throw toAppError(error);
  return (data as TicketRow[] | null)?.map(toTicket) ?? [];
}

export async function getTicket(id: string): Promise<SupportTicket | null> {
  const { data, error } = await supabase
    .from('support_tickets')
    .select(SELECT)
    .eq('id', id)
    .maybeSingle();

  if (error) throw toAppError(error);
  return data ? toTicket(data as TicketRow) : null;
}

/**
 * How many requests are left in the caller's rolling 24h window. Used to show
 * calm copy *before* someone writes a detailed bug report and then gets
 * refused.
 */
export async function remainingToday(): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from('support_tickets')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', since);

  if (error) throw toAppError(error);
  return Math.max(0, TICKETS_PER_DAY - (count ?? 0));
}

/** True when a ticket has a reply the owner has not opened yet. */
export function hasUnreadReply(t: SupportTicket): boolean {
  return t.replies.some((r) => r.readAt == null);
}

/**
 * Submit a request. Returns the new ticket's id.
 *
 * The cap is enforced in the RPC, which raises `daily_cap_reached`. That is a
 * deliberate, expected outcome rather than a fault, so it is translated into a
 * `rate_limited` AppError — the one error kind whose copy already says "not
 * right now" instead of "something went wrong".
 */
export async function submitTicket(input: {
  body: string;
  topic: SupportTopic;
  area: SupportArea;
  entrySource: SupportEntrySource;
  petId?: string | null;
  diagnostics?: SupportDiagnostics | null;
}): Promise<string> {
  const body = input.body.trim();
  if (!body) throw appError('validation', 'submitTicket called with an empty body');

  const { data, error } = await supabase.rpc('submit_support_ticket', {
    p_body: body.slice(0, SUPPORT_MAX_CHARS),
    p_topic: input.topic,
    p_area: input.area,
    p_entry_source: input.entrySource,
    p_pet_id: input.petId ?? null,
    p_diagnostics: input.diagnostics ?? null,
    p_attachment_path: null,
  });

  if (error) {
    if (error.message?.includes('daily_cap_reached')) {
      throw appError('rate_limited', 'support ticket daily cap reached');
    }
    throw toAppError(error);
  }
  return data as string;
}

/**
 * Upload a screenshot and attach it to a ticket that already exists.
 *
 * Best-effort by contract: the text is the support request and the screenshot
 * is a bonus, so a failed upload resolves to `false` rather than throwing. A
 * bug report lost because a photo would not upload is the worst possible
 * outcome of adding photo support at all.
 *
 * The object key must start with the owner's id — that first path segment is
 * what the storage RLS policy checks.
 */
export async function attachScreenshot(input: {
  ticketId: string;
  ownerId: string;
  uri: string;
  mimeType?: string | null;
}): Promise<boolean> {
  try {
    const path = `${input.ownerId}/${input.ticketId}.jpg`;

    // React Native has no File/Blob for a local uri, so the multipart form is
    // assembled by hand — the same approach the avatar upload in
    // app/(tabs)/profile.tsx uses.
    const form = new FormData();
    form.append('file', {
      uri: input.uri,
      name: `${input.ticketId}.jpg`,
      type: input.mimeType || 'image/jpeg',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const { error: uploadError } = await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .upload(path, form, { contentType: 'image/jpeg', upsert: true });

    if (uploadError) return false;

    // Recorded via an RPC rather than an UPDATE: owners have no UPDATE policy
    // on support_tickets, by the same reasoning that keeps them off replies.
    const { error: linkError } = await supabase.rpc('attach_support_screenshot', {
      p_ticket_id: input.ticketId,
      p_path: path,
    });

    return !linkError;
  } catch {
    return false;
  }
}

/**
 * Stamp a reply as read. Owners have no UPDATE policy on replies by design, so
 * this runs definer-side.
 *
 * Best-effort: a failed read receipt must never stop someone reading their
 * reply, so this swallows rather than throws.
 */
export async function markReplyRead(ticketId: string): Promise<void> {
  try {
    await supabase.rpc('mark_support_reply_read', { p_ticket_id: ticketId });
  } catch {
    // Non-fatal by design.
  }
}

export type { AppError };
