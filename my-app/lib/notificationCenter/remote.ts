/**
 * Pushes already sent, read back as inbox items.
 *
 * `notification_history` stores no copy — only `campaign_key` and `variant`.
 * That is a feature, not a gap: re-rendering through `renderCopy()` means the
 * center shows exactly the catalogue the dispatcher shipped, and cannot drift
 * from it the way a denormalised title column would.
 *
 * The trade-off is that copy referring to interpolated numbers ("the window
 * opens in 20 minutes") loses those numbers on re-render, because the ledger
 * never kept them. `renderCopy` already degrades to a shorter sentence when a
 * context value is absent, which is exactly the behaviour we want here — a
 * stale countdown would be worse than no countdown.
 */

import { supabase } from '../supabase';
import { ALL_CAMPAIGNS, renderCopy, type CampaignKey, type PetSex } from '../notifications/copy';
import { iconForCampaign, routeForCampaign, toneForCampaign } from './catalogue';
import { PERSISTENT_SCOPE, stableId } from './stableId';
import type { InboxItem } from './types';

/** How far back the center looks. Older than this is history, not a notification. */
const LOOKBACK_DAYS = 30;
/** Hard cap, so a chatty month cannot make the screen unscrollable. */
const MAX_ROWS = 60;

interface HistoryRow {
  id: string;
  campaign_key: string | null;
  event_type: string | null;
  sent_at: string | null;
  created_at: string | null;
  dedupe_key: string | null;
  read_at: string | null;
  channel: string | null;
}

export interface RemoteFetchContext {
  petName?: string | null;
  petSex?: PetSex;
}

/**
 * Recent pushes for the signed-in owner.
 *
 * Returns an empty list rather than throwing on any failure. The center is
 * assembled from four sources and three of them are local — a Supabase hiccup
 * should cost the remote section, not the whole screen.
 */
export async function fetchRemoteItems(ctx: RemoteFetchContext): Promise<InboxItem[]> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('notification_history')
    // RLS restricts this to the caller's own rows — see
    // 20260818000000_notification_inbox.sql. No user_id filter is needed and
    // adding one would only hide a policy regression.
    .select('id, campaign_key, event_type, sent_at, created_at, dedupe_key, read_at, channel')
    .gte('sent_at', since)
    .order('sent_at', { ascending: false })
    .limit(MAX_ROWS);

  if (error || !data) return [];

  const items: InboxItem[] = [];
  for (const row of data as HistoryRow[]) {
    const item = toItem(row, ctx);
    if (item) items.push(item);
  }
  return items;
}

/** Unread pushes, without paying for the copy render. Drives the badge. */
export async function fetchRemoteUnreadCount(): Promise<number> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from('notification_history')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null)
    .gte('sent_at', since);
  return error ? 0 : (count ?? 0);
}

/** Stamps read_at through the narrow RPC. Silent on failure — read state is not worth a toast. */
export async function markRemoteRead(dedupeKey: string): Promise<void> {
  await supabase.rpc('mark_notification_read', { p_dedupe_key: dedupeKey }).then(
    () => {},
    () => {},
  );
}

export async function markAllRemoteRead(): Promise<void> {
  await supabase.rpc('mark_all_notifications_read').then(
    () => {},
    () => {},
  );
}

function isCampaignKey(value: string | null | undefined): value is CampaignKey {
  return !!value && (ALL_CAMPAIGNS as readonly string[]).includes(value);
}

function toItem(row: HistoryRow, ctx: RemoteFetchContext): InboxItem | null {
  // Email rows share this ledger. They are not app notifications and showing
  // them here would tell the owner they "received" something in a place they
  // demonstrably did not.
  if (row.channel && row.channel !== 'push') return null;

  // `event_type` is the legacy column and carries the same value for every row
  // the current dispatcher writes; older rows only have that one.
  const key = row.campaign_key ?? row.event_type;
  if (!isCampaignKey(key)) return null;

  let copy;
  try {
    copy = renderCopy(key, { petName: ctx.petName, petSex: ctx.petSex });
  } catch {
    // A campaign whose renderer needs context we cannot reconstruct. Dropping
    // one row beats rendering a sentence with a hole in it.
    return null;
  }

  const sentAt = row.sent_at ?? row.created_at;
  if (!sentAt) return null;

  return {
    // Scoped by the ledger row id, so it is one item forever — a push is a
    // historical fact and does not come back tomorrow the way a nudge does.
    id: stableId('push', `${key}_${row.id}`, PERSISTENT_SCOPE),
    source: 'push',
    tone: toneForCampaign(key),
    title: copy.title,
    body: copy.body,
    icon: iconForCampaign(key),
    createdAt: sentAt,
    route: routeForCampaign(key) ?? undefined,
    dedupeKey: row.dedupe_key ?? undefined,
    meta: { campaign_key: key, server_read: row.read_at !== null },
  };
}
