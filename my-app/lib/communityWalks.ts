import { supabase } from './supabase';
import { UserFacingError, isTransientError } from './appError';
import { beginWrite, cacheKey, commitSnapshot, isFresh, readSnapshot, writeOptimistic, writeSnapshot } from './communityCache';
import { currentUserId } from './sessionUser';
import { isValidUsername, normalizeUsername } from './communityUsername';
import { mergeTraces } from './community/memoryTraces';
import { isMissingFunction, toPreviousInvitee, type PreviousInvitee } from './community/previousInvitees';
import { toInvitationPreview, type InvitationPreview } from './community/invitationPreview';
import { composeOutingSnapshot, decodeOuting, type PackAttendanceEntry } from './community/outingDoc';
import { isPerfFlagOn } from './perfFlags';
import { LIVE_PROTOCOL } from './community/liveProtocol';
import { pickNextOpenWalk } from './community/walkPass';
import { parseWalkCards, type WalkCard } from './community/walkCards';

export { isValidUsername, normalizeUsername } from './communityUsername';

export type PackRole = 'owner' | 'member';
export type InvitationState =
  | 'pending'
  | 'pending_host'
  | 'accepted'
  | 'declined'
  | 'revoked'
  | 'expired';
export type OutingState = 'planned' | 'active' | 'completed' | 'cancelled';
export type AttendanceStatus =
  | 'invited'
  | 'coming'
  | 'cant_make_it'
  | 'checked_in'
  | 'walking'
  | 'finished';

export interface CommunityDog {
  id: string;
  owner_id?: string;
  name: string;
  image_url: string | null;
}

export interface CommunityPerson {
  id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
}

export interface PackMember {
  pack_id: string;
  user_id: string;
  role: PackRole;
  joined_at: string;
  notifications_muted: boolean;
  person?: CommunityPerson;
  dogs: CommunityDog[];
}

export interface CommunityPack {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
  role?: PackRole;
  memberCount?: number;
  dogs?: CommunityDog[];
  nextWalk?: CommunityWalk | null;
  /**
   * What the Trail's card shows, in the order the card should prefer them.
   *
   * A photo the pack actually contributed outranks a map, because a trail that
   * has been walked should look like the walk rather than like a plan. Both are
   * optional: a brand-new trail whose meeting point could not be geocoded has
   * neither, and the card says so rather than inventing a picture.
   */
  coverPath?: string | null;
  /** How many people have said yes to `nextWalk`. Absent when there is none. */
  goingCount?: number;
  /** This owner's own answer to `nextWalk`, if they have given one. */
  myStatus?: AttendanceStatus | null;
  /**
   * Who is running `nextWalk`, by name, for the line that reads "Mira hosts".
   *
   * Null when the organiser has no display name — the subtitle drops the whole
   * clause rather than printing " hosts", which is how a missing name announces
   * itself as a bug.
   */
  hostName?: string | null;
}

export interface CommunityInvitation {
  id: string;
  pack_id: string;
  inviter_id: string;
  invitee_id: string | null;
  invite_code: string;
  claimed_by: string | null;
  state: InvitationState;
  expires_at: string;
  created_at: string;
  pack?: CommunityPack;
  inviter?: CommunityPerson;
  dogs?: CommunityDog[];
}

export interface CommunityWalk {
  id: string;
  pack_id: string;
  organizer_id: string;
  title: string;
  scheduled_for: string | null;
  meeting_label: string;
  meeting_lat: number | null;
  meeting_lng: number | null;
  note: string | null;
  state: OutingState;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WalkAttendance {
  walk_id: string;
  user_id: string;
  status: AttendanceStatus;
  share_location: boolean;
  checked_in_at: string | null;
  joined_at: string | null;
  finished_at: string | null;
  updated_at: string;
  person?: CommunityPerson;
  dogs?: CommunityDog[];
}

export interface LiveParty {
  walk_id: string;
  user_id: string;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  path: { lat: number; lng: number }[];
  recorded_at: string;
}

export interface SharedMoment {
  id: string;
  walk_id: string;
  contributor_id: string;
  walk_media_id: string;
  dog_ids: string[];
  display_path: string | null;
  captured_at: string;
  capture_lat: number | null;
  capture_lng: number | null;
  caption: string | null;
  external_share_allowed: boolean;
  published_at: string;
  heartCount?: number;
  heartedByMe?: boolean;
}

/**
 * One walker's own recording of a shared walk.
 *
 * Attributed, which the memory's `routes` deliberately are not — that array is
 * anonymous geometry for the share-card artwork, where whose line is whose is
 * not the point and naming them would leak more than the card intends. A row
 * in the pack list is the opposite: it is entirely about whose line it is.
 *
 * Every number here was measured by that person's own phone. There is no
 * shared distance for a walk, only several honest ones.
 */
export interface WalkerTrace {
  userId: string;
  /**
   * Every recording this person linked to the walk, as separate segments.
   *
   * Plural, and it has to be. `community_walk_sessions` is unique on
   * (walk_id, user_id, walk_session_id), so one person can link several
   * personal recordings to one community walk — they stopped and restarted, or
   * the outing outlasted a recording. Production already has walkers with four.
   *
   * Kept apart rather than concatenated: joining two recordings end to end
   * draws a straight line from where one stopped to where the next began,
   * across whatever is in between. That line is not a route anybody walked.
   */
  routes: { lat: number; lng: number }[][];
  distanceM: number;
  durationS: number;
  /** Sniff stops the recorder detected. Zero is a real answer. */
  sniffs: number;
}

export interface CommunityMemory {
  walk: CommunityWalk;
  pack: CommunityPack;
  attendance: WalkAttendance[];
  moments: SharedMoment[];
  sessionIds: string[];
  routes: { lat: number; lng: number }[][];
  /** The same recordings as `routes`, with a name against each. */
  traces: WalkerTrace[];
}

export interface UsernameMatch extends CommunityPerson {
  dogs: CommunityDog[];
}

/** Someone invited to a trail who has not joined it yet. */
export interface PendingInvite extends UsernameMatch {
  invitation_id: string;
  state: 'pending' | 'declined';
  created_at: string;
  expires_at: string;
  /** Derived, not stored: a lapsed invitation is worth re-sending. */
  expired: boolean;
}

export interface ExternalInviteClaim extends UsernameMatch {
  invitation_id: string;
  claimant_id: string;
  claimed_at: string;
}

/**
 * The trail's host — the one person who runs it.
 *
 * ── Owner, not organiser ───────────────────────────────────────────────────
 *
 * Every screen used to ask `walk.organizer_id === user.id`, which meant
 * whoever created a walk controlled it, and any member could create one. A
 * trail now has a single host: planning, starting, ending, editing the plan
 * and inviting all belong to them, and the database enforces it
 * (20260922020000_trail_host_authority).
 *
 * This reads the PACK's owner rather than the walk's organiser on purpose.
 * Those are the same person for every walk created from now on, but not for
 * the walks that already exist — and ownership is the durable fact. It also
 * means a trail whose ownership is transferred moves its controls with it,
 * rather than stranding them on whoever happened to press the button once.
 *
 * Exported as one function rather than repeated inline so a screen cannot
 * quietly disagree with the policy about who is in charge.
 */
export function isTrailHost(
  pack: Pick<CommunityPack, 'owner_id'> | null | undefined,
  userId: string | null | undefined,
): boolean {
  return !!pack && !!userId && pack.owner_id === userId;
}

function unwrap<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  if (data === null) throw new Error('Nothing was returned.');
  return data;
}

/**
 * The viewer's own username, as last seen.
 *
 * `undefined` means nobody has looked yet, which is NOT the same as `null`
 * ("looked, and they have not chosen one"). The Together prompt keys off that
 * difference — it must not flash at somebody who simply has not been read yet.
 */
let knownUsername: string | null | undefined;

function rememberUsername(value: string | null): void {
  knownUsername = value;
}

/** Forgotten on sign-out with the rest of the previous account's memory. */
export function resetKnownUsername(): void {
  knownUsername = undefined;
}

/**
 * Free when the trails list has already been loaded, which on the only screen
 * that asks is always. `community_trails_for_me` returns this column, so the
 * separate round trip this used to make on every focus is now redundant — but
 * the function stays, because the owner's profile screen reads it without ever
 * touching Together.
 */
export async function getMyUsername(): Promise<string | null> {
  if (knownUsername !== undefined) return knownUsername;
  const userId = await currentUserId();
  if (!userId) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const username = (data?.username as string | null | undefined) ?? null;
  rememberUsername(username);
  return username;
}

export async function listMyDogs(): Promise<CommunityDog[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  const { data, error } = await supabase
    .from('pets')
    .select('id, owner_id, name, image_url')
    .eq('owner_id', userId)
    .eq('species', 'dog')
    .order('created_at');
  if (error) throw new Error(error.message);
  return (data ?? []) as CommunityDog[];
}

export async function saveMyUsername(value: string): Promise<string> {
  const username = normalizeUsername(value);
  if (!isValidUsername(username)) {
    throw new UserFacingError('Use 3–24 lowercase letters, numbers or underscores.');
  }
  const userId = await currentUserId();
  if (!userId) throw new UserFacingError('Sign in to choose a username.');
  const { error } = await supabase.from('profiles').update({ username }).eq('id', userId);
  if (error) {
    if (error.code === '23505') throw new UserFacingError('That username is already taken.');
    throw new Error(error.message);
  }
  // Kept in step with the write, or the memoised read above would keep
  // answering with the handle they just changed.
  rememberUsername(username);
  return username;
}

/**
 * Is this username free? `null` means we could not find out.
 *
 * ── Why this is not lookupUsername ─────────────────────────────────────────
 *
 * `lookup_community_username` is the wrong instrument and would ship three
 * bugs. It is capped at 30 calls an hour and audits each one, so a field that
 * checks while you type would spend a person's entire hour of lookups choosing
 * one name and then break "invite someone you know" — the feature that cap
 * protects. It also hides anyone you have blocked, whose username still holds
 * the unique index, so it would call a name free and the write would then fail
 * with 23505. And it hands back a name, an avatar and a list of dogs to answer
 * a yes/no question.
 *
 * `community_username_available` returns a bare boolean and nothing else.
 *
 * ── Never throws ───────────────────────────────────────────────────────────
 *
 * Every failure becomes `null`, including the RPC being absent on a database
 * this build has outrun. Availability is reassurance, not permission: the
 * unique index is what actually decides, at the moment of the write. A field
 * that cannot reach this must still let the person type and save.
 */
export async function isUsernameAvailable(value: string): Promise<boolean | null> {
  const username = normalizeUsername(value);
  if (!isValidUsername(username)) return null;
  try {
    const { data, error } = await supabase.rpc('community_username_available', {
      p_username: username,
    });
    if (error) return null;
    return typeof data === 'boolean' ? data : null;
  } catch {
    return null;
  }
}

export async function lookupUsername(value: string): Promise<UsernameMatch | null> {
  const username = normalizeUsername(value);
  if (!isValidUsername(username)) return null;
  const { data, error } = await supabase.rpc('lookup_community_username', { p_username: username });
  if (error) throw new Error(error.message);
  const row = (data as any[])?.[0];
  if (!row) return null;
  return {
    id: row.user_id,
    username: row.username,
    full_name: row.full_name,
    avatar_url: row.avatar_url,
    dogs: Array.isArray(row.dogs) ? row.dogs : [],
  };
}

// COVER_WALK_SCAN_LIMIT, COMING_STATUSES and MY_ATTENDANCE_LIMIT used to live
// here. They existed to bound client-side IN lists that `listPacks` assembled
// across three waves of queries — a cap on how many walk ids could go into a
// URL before meeting a 414, essentially. `community_trails_for_me` does that
// work in SQL where there is no URL and nothing to bound, so the caps went
// with the queries.
//
// The one rule among them that mattered is not a cap and did not go: "coming"
// is ('coming','checked_in','walking','finished') and never 'invited', because
// being asked is not an answer. It now lives in the RPC's goingCount, which is
// the only place that counts.

/** Unanswered walk invitations read for the waiting pill. */
const WALK_INVITE_LIMIT = 50;

/** Completed walks scanned to find one drawable route per trail. */
const TRAIL_ROUTE_SCAN_LIMIT = 60;

/**
 * Every trail this owner is in, shaped for the Together sheet.
 *
 * ── This used to be nine queries in three serial waves ─────────────────────
 *
 * Memberships, then members + upcoming walks + walk ids + my answers, then
 * photos + attendance + dogs + profiles — each wave waiting on ids the last
 * one produced. Three round trips to Tokyo before the list could paint, and
 * one of those queries (`pets`) cost 95 ms on its own: 60 ms of RLS PLANNING,
 * because `pets` carries four permissive policies OR'd together and PostgREST
 * re-plans them per request.
 *
 * `community_trails_for_me` is the same answer in one round trip. Being
 * SECURITY DEFINER it also never plans that disjunction — it does its own
 * authorisation instead, which is why the function checks `auth.uid()` before
 * it reads anything.
 *
 * The username rides along. It was a separate round trip on every focus, for
 * one column of a row this already had open.
 */
export async function listPacks(): Promise<CommunityPack[]> {
  const userId = await currentUserId();
  // Not `[]`: an empty list here reads as "you have no meetups", and not
  // knowing who is asking is not that. Callers keep what they had and say
  // they could not check.
  if (!userId) throw new Error('auth_required');

  const ticket = beginWrite(cacheKey.packs());
  const { data, error } = await supabase.rpc('community_trails_for_me');
  if (error) throw new Error(error.message);

  const doc = (data ?? {}) as { trails?: unknown; username?: unknown };
  const resolved = (Array.isArray(doc.trails) ? doc.trails : []) as CommunityPack[];
  // Remembered here so `getMyUsername` below can answer without the network.
  rememberUsername(typeof doc.username === 'string' ? doc.username : null);
  commitSnapshot(ticket, resolved);
  return resolved;
}

/**
 * Pin the meeting point on the map, best-effort, after the walk exists.
 *
 * A separate UPDATE rather than an argument to create_community_walk: the RPC
 * takes only a text label, and `community_walks_update_organizer` already lets
 * the organiser set these columns. Geocoding is allowed to fail — plenty of
 * real meeting points ("the bench by the big tree") are not addresses, and the
 * card falls back to a plain map rather than refusing to show the trail.
 */
export async function setOutingMeetingPoint(
  walkId: string,
  lat: number,
  lng: number,
): Promise<void> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  await supabase
    .from('community_walks')
    .update({ meeting_lat: lat, meeting_lng: lng })
    .eq('id', walkId);
}

/**
 * Put a just-created trail at the top of the cached list, before anybody asks
 * for it.
 *
 * Home keeps its trails in state and refetches when it regains focus, which
 * takes a couple of round trips. For those few hundred milliseconds the list
 * the host is looking at is the list from before they created anything — so
 * finishing the creation flow landed them on a screen that did not contain the
 * thing they had just made. There is no worse moment to look like nothing
 * happened.
 *
 * Everything here is known for certain rather than assumed: the host is its
 * only member, they own it, and it has exactly the walk that was just planned.
 * The refetch replaces it wholesale a moment later regardless.
 */
export function rememberNewPack(pack: CommunityPack, firstWalk: CommunityWalk | null): void {
  const existing = readSnapshot<CommunityPack[]>(cacheKey.packs()) ?? [];
  const entry: CommunityPack = {
    ...pack,
    role: 'owner',
    memberCount: 1,
    dogs: [],
    nextWalk: firstWalk,
    coverPath: null,
  };
  // Optimistic, not authoritative: this row is something we assembled, and the
  // refetch on the next focus must still happen to replace it. `writeSnapshot`
  // here would mark the list fresh and suppress exactly that.
  writeOptimistic(cacheKey.packs(), [entry, ...existing.filter(row => row.id !== pack.id)]);
}

export async function createPack(name: string): Promise<CommunityPack> {
  const clean = name.trim();
  if (clean.length < 2) throw new UserFacingError('Give the pack a name.');
  const { data, error } = await supabase.rpc('create_community_pack', { p_name: clean });
  return unwrap(data as CommunityPack | null, error);
}

export async function listInvitations(): Promise<CommunityInvitation[]> {
  const { data, error } = await supabase.rpc('get_my_community_invitations');
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: any) => ({
    id: row.invitation_id,
    pack_id: row.pack_id,
    inviter_id: row.inviter_id,
    invitee_id: null,
    invite_code: row.invite_code,
    claimed_by: null,
    state: row.state,
    expires_at: row.expires_at,
    created_at: row.created_at,
    pack: { id: row.pack_id, name: row.pack_name } as CommunityPack,
    inviter: {
      id: row.inviter_id,
      username: row.inviter_username,
      full_name: row.inviter_name,
      avatar_url: null,
    },
    dogs: Array.isArray(row.dogs) ? row.dogs : [],
  })) as CommunityInvitation[];
}

/**
 * A walk you have been asked to, on a trail you are already in.
 *
 * ── The third kind of question ─────────────────────────────────────────────
 *
 * The waiting pill already carried two: an invitation to join a trail, and a
 * stranger asking to be let into one you host. This is neither. You are in the
 * pack already; somebody has asked whether you are coming on Sunday.
 *
 * It was reachable only by opening the walk's own screen, which is precisely
 * the screen you do not open if you never learned there was a walk. A host
 * asked four people and heard nothing back, because being asked was invisible
 * everywhere except inside the thing you were being asked about.
 *
 * Only walks still ahead: an `invited` row on a walk that has already finished
 * is a question nobody can answer any more, and putting it in front of someone
 * would be asking them to RSVP to last Tuesday.
 */
export interface WalkInvitation {
  walkId: string;
  packId: string;
  packName: string;
  title: string;
  scheduledFor: string | null;
  meetingLabel: string;
}

export async function listWalkInvitations(): Promise<WalkInvitation[]> {
  const userId = await currentUserId();
  if (!userId) return [];

  // Embedded rather than a second round trip, the same way `listPacks` reads a
  // membership's pack. One FK, so the relationship is unambiguous.
  //
  // The pack's NAME is embedded one level deeper for the same reason. It used
  // to be a second query keyed on the pack ids this one produced — a whole
  // round trip to turn a handful of UUIDs into a handful of names, on a pill
  // that is often showing a single number.
  const { data, error } = await supabase
    .from('community_walk_attendance')
    .select(
      'walk_id, community_walks!inner(id, pack_id, title, scheduled_for, meeting_label, state, community_packs(id, name))',
    )
    .eq('user_id', userId)
    .eq('status', 'invited')
    .limit(WALK_INVITE_LIMIT);
  if (error) throw new Error(error.message);

  const rows = ((data ?? []) as any[])
    .map(row => (Array.isArray(row.community_walks) ? row.community_walks[0] : row.community_walks))
    .filter(walk => walk && (walk.state === 'planned' || walk.state === 'active'));
  if (!rows.length) return [];

  return rows.map((walk: any) => {
    const pack = Array.isArray(walk.community_packs) ? walk.community_packs[0] : walk.community_packs;
    return {
      walkId: walk.id,
      packId: walk.pack_id,
      // "A trail" rather than an empty string: the row reads as a sentence and
      // a nameless trail should still be answerable.
      packName: pack?.name ?? 'A meetup',
      title: walk.title,
      scheduledFor: walk.scheduled_for,
      meetingLabel: walk.meeting_label,
    };
  });
}

/**
 * The walk a new member should answer next in a meetup: one running now, else
 * the soonest planned. Null when there is none (or it could not be read — the
 * caller then simply stays where it is).
 *
 * Exists because joining a meetup is not joining its walk: a walk planned
 * before you joined has no seat for you, and nothing said so (device report,
 * 2026-10-07). Accepting now leads straight to that walk's "Can you make it?".
 */
export async function nextOpenWalkId(packId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('community_walks')
    .select('id, state, scheduled_for')
    .eq('pack_id', packId)
    .in('state', ['planned', 'active'])
    .limit(10);
  if (error || !data) return null;
  return pickNextOpenWalk(data as { id: string; state: string; scheduled_for: string | null }[]);
}

export async function respondToInvitation(invitationId: string, accept: boolean): Promise<void> {
  const { data, error } = await supabase.rpc('respond_community_invitation', {
    p_invitation_id: invitationId,
    p_accept: accept,
  });
  if (error) throw new Error(error.message);
  if (data === 'not_available') throw new UserFacingError('That invitation is no longer available.');
}

export async function inviteUsername(packId: string, username: string): Promise<CommunityInvitation> {
  const { data, error } = await supabase.rpc('invite_community_username', {
    p_pack_id: packId,
    p_username: normalizeUsername(username),
  });
  return unwrap(data as CommunityInvitation | null, error);
}

/**
 * People this HOST has invited before, for one-tap re-inviting.
 *
 * Host only, and only their own history — both enforced by the function, not
 * here (migration 20260924000000_previous_invitees). Throws the raw message so
 * the caller can tell "not on this database yet" from a real failure.
 */
export async function listPreviousInvitees(packId: string): Promise<PreviousInvitee[]> {
  const { data, error } = await supabase.rpc('community_previous_invitees', { p_pack_id: packId });
  if (error) throw new Error(error.message);
  return ((data as Record<string, unknown>[] | null) ?? [])
    .map(toPreviousInvitee)
    .filter((person): person is PreviousInvitee => person !== null);
}

/** Invite several previous invitees at once. Resolves to how many were newly invited. */
export async function invitePreviousInvitees(packId: string, userIds: string[]): Promise<number> {
  const { data, error } = await supabase.rpc('invite_previous_community_invitees', {
    p_pack_id: packId,
    p_user_ids: userIds,
  });
  if (error) throw new Error(error.message);
  return typeof data === 'number' ? data : 0;
}

/**
 * A look inside the meetup an invitation is for, before answering it.
 * Only the invited person, only while pending — see migration 20260926020000.
 */
export async function loadInvitationPreview(invitationId: string): Promise<InvitationPreview> {
  const { data, error } = await supabase.rpc('community_invitation_preview', { p_invitation_id: invitationId });
  if (error) throw new Error(error.message);
  const preview = toInvitationPreview(data);
  if (!preview) throw new Error('invitation_not_available');
  return preview;
}

export async function createExternalInvite(packId: string): Promise<CommunityInvitation> {
  const { data, error } = await supabase.rpc('create_external_community_invite', {
    p_pack_id: packId,
  });
  return unwrap(data as CommunityInvitation | null, error);
}

/**
 * What opening an invite link did (20261005000000).
 *
 *   host_confirmation_required  sent to the host (also on a repeat)
 *   own_invite                  the link is the caller's own; it is untouched
 *   already_member              the caller is already in that meetup; untouched
 *   invalid_or_expired          used by someone else, expired, or no such link
 */
export type InviteClaimOutcome = 'host_confirmation_required' | 'own_invite' | 'already_member' | 'invalid_or_expired';

export async function claimExternalInvite(code: string): Promise<InviteClaimOutcome> {
  const { data, error } = await supabase.rpc('claim_external_community_invite', { p_code: code.trim() });
  if (error) throw new Error(error.message);
  // An older server answers only the first and last; anything unknown is
  // treated as unusable rather than guessed at.
  return data === 'host_confirmation_required' || data === 'own_invite' || data === 'already_member'
    ? data
    : 'invalid_or_expired';
}

export async function listExternalInviteClaims(packId: string): Promise<ExternalInviteClaim[]> {
  const { data, error } = await supabase.rpc('list_external_community_claims', { p_pack_id: packId });
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map(row => ({
    ...row,
    id: row.claimant_id,
    dogs: Array.isArray(row.dogs) ? row.dogs : [],
  })) as ExternalInviteClaim[];
}

/**
 * Everyone waiting to be let into any of these trails, in one call.
 *
 * Home asked `list_external_community_claims` once PER owned trail to draw a
 * single number on a single pill — eight trails meant eight concurrent round
 * trips, competing for the four-or-so sockets React Native allows per host and
 * so delaying the requests the list itself was waiting on.
 *
 * The RPC checks ownership per row and silently drops trails the caller does
 * not own, rather than raising: this list is assembled client-side, and one
 * stale id in it should cost that trail's requests, not the whole pill.
 */
export async function listClaimsForPacks(packIds: string[]): Promise<ExternalInviteClaim[]> {
  if (!packIds.length) return [];
  const { data, error } = await supabase.rpc('community_claims_for_packs', {
    p_pack_ids: packIds,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map(row => ({
    ...row,
    id: row.claimant_id,
    dogs: Array.isArray(row.dogs) ? row.dogs : [],
  })) as ExternalInviteClaim[];
}

export async function approveExternalInvite(invitationId: string, approve: boolean): Promise<void> {
  const { data, error } = await supabase.rpc('approve_external_community_invite', {
    p_invitation_id: invitationId,
    p_approve: approve,
  });
  if (error) throw new Error(error.message);
  if (data === 'not_available') throw new UserFacingError('That request is no longer available.');
}

export interface PackSnapshot {
  pack: CommunityPack;
  members: PackMember[];
  walks: CommunityWalk[];
  invited: PendingInvite[];
}

function toPendingInvites(rows: unknown, now: number): PendingInvite[] {
  return ((rows ?? []) as any[]).map(row => ({
    invitation_id: row.invitation_id,
    id: row.invitee_id,
    username: row.username,
    full_name: row.full_name,
    avatar_url: row.avatar_url,
    dogs: Array.isArray(row.dogs) ? row.dogs : [],
    state: row.state,
    created_at: row.created_at,
    expires_at: row.expires_at,
    expired: row.state === 'pending' && Date.parse(row.expires_at) < now,
  })) as PendingInvite[];
}

/**
 * A meetup's screen: the pack, its members (with names and dogs), its recent
 * walks, and who has been invited.
 *
 * Was six requests in two waves — pack, members and walks, THEN profiles, dogs
 * and invitations — on every open of the meetup, its settings and its invite
 * screen. `community_pack_detail` (migration 20260926010000) returns the first
 * five in one read, with the old policies' rules restated inside it; the
 * invitation roster keeps its own RPC and rides in the same wave. It also
 * skips the `pets` RLS planning that made that one query cost ~95 ms.
 *
 * Falls back to the six reads only when the function is not deployed yet.
 */
export async function loadPack(packId: string): Promise<PackSnapshot> {
  const ticket = beginWrite(cacheKey.pack(packId));
  const [detail, invitations] = await Promise.all([
    supabase.rpc('community_pack_detail', { p_pack_id: packId }),
    supabase.rpc('list_pack_invitations', { p_pack_id: packId }),
  ]);
  if (detail.error && isMissingFunction(detail.error.message)) return loadPackLegacy(packId, ticket);
  if (detail.error) throw new Error(detail.error.message);
  if (invitations.error) throw new Error(invitations.error.message);

  const doc = (detail.data ?? {}) as { pack?: unknown; members?: unknown; walks?: unknown; attendance?: unknown };
  if (!doc.pack) throw new UserFacingError('This meetup could not load.');
  const snapshot: PackSnapshot = {
    pack: doc.pack as CommunityPack,
    members: ((Array.isArray(doc.members) ? doc.members : []) as any[]).map(row => ({
      ...row,
      person: row.person ?? undefined,
      dogs: Array.isArray(row.dogs) ? row.dogs : [],
    })) as PackMember[],
    walks: (Array.isArray(doc.walks) ? doc.walks : []) as CommunityWalk[],
    invited: toPendingInvites(invitations.data, Date.now()),
  };

  commitSnapshot(ticket, snapshot);
  // Who has answered each listed walk (20261002040000). Absent on a database
  // without that migration, which leaves every walk on the plain partial prime.
  const answered = toWalkAttendance(doc.attendance);
  for (const walk of snapshot.walks) {
    const rows = answered?.[walk.id];
    primeOuting(walk, snapshot.pack, rows ? { members: snapshot.members, attendance: rows } : undefined);
  }
  return snapshot;
}

/** `community_pack_detail.attendance`: walk id → that walk's answers, or null if absent. */
function toWalkAttendance(raw: unknown): Record<string, PackAttendanceEntry[]> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, PackAttendanceEntry[]> = {};
  for (const [walkId, rows] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(rows)) out[walkId] = rows as PackAttendanceEntry[];
  }
  return out;
}

async function loadPackLegacy(packId: string, ticket: ReturnType<typeof beginWrite>): Promise<PackSnapshot> {
  const [{ data: pack, error: packError }, { data: memberRows, error: memberError }, { data: walks, error: walkError }] =
    await Promise.all([
      supabase.from('community_packs').select('*').eq('id', packId).single(),
      supabase
        .from('community_pack_members')
        .select('pack_id, user_id, role, joined_at, notifications_muted')
        .eq('pack_id', packId)
        .order('joined_at'),
      supabase
        .from('community_walks')
        .select('*')
        .eq('pack_id', packId)
        .order('scheduled_for', { ascending: false, nullsFirst: false })
        .limit(30),
    ]);
  if (packError) throw new Error(packError.message);
  if (memberError) throw new Error(memberError.message);
  if (walkError) throw new Error(walkError.message);

  // The invitation roster depends on the pack, not on the member ids, so it
  // rides along with the profile fetch instead of waiting behind it. It used to
  // be a third serial round trip, which is a third of this screen's open time
  // spent doing nothing.
  const ids = (memberRows ?? []).map((row: any) => row.user_id);
  const [
    { data: profiles, error: profileError },
    { data: dogs, error: dogError },
    { data: invitedRows, error: invitedError },
  ] = await Promise.all([
    ids.length
      ? supabase.from('profiles').select('id, username, full_name, avatar_url').in('id', ids)
      : Promise.resolve({ data: [] as any[], error: null }),
    ids.length
      ? supabase.from('pets').select('id, owner_id, name, image_url').eq('species', 'dog').in('owner_id', ids)
      : Promise.resolve({ data: [] as any[], error: null }),
    supabase.rpc('list_pack_invitations', { p_pack_id: packId }),
  ]);
  // A failure here used to be ignored and the half-built result cached as a
  // good one: every member rendered as "Friend" with no dogs until the next
  // load happened to succeed. Throwing keeps whatever the screen already shows
  // (every caller keeps its cached content on error) and caches nothing wrong.
  if (profileError) throw new Error(profileError.message);
  if (dogError) throw new Error(dogError.message);
  if (invitedError) throw new Error(invitedError.message);

  // Who has been asked but has not answered. Through an RPC because the host
  // cannot read a pending invitee's profile directly — every profiles policy
  // needs a shared pack, and that is precisely what an invitation has not
  // created yet. See 20260917171343_pack_invitation_roster.sql.
  const now = Date.now();

  const snapshot: PackSnapshot = {
    pack: pack as CommunityPack,
    members: (memberRows ?? []).map((row: any) => ({
      ...row,
      person: (profiles ?? []).find((profile: any) => profile.id === row.user_id),
      dogs: (dogs ?? []).filter((dog: any) => dog.owner_id === row.user_id),
    })) as PackMember[],
    walks: (walks ?? []) as CommunityWalk[],
    invited: ((invitedRows ?? []) as any[]).map(row => ({
      invitation_id: row.invitation_id,
      id: row.invitee_id,
      username: row.username,
      full_name: row.full_name,
      avatar_url: row.avatar_url,
      dogs: Array.isArray(row.dogs) ? row.dogs : [],
      state: row.state,
      created_at: row.created_at,
      expires_at: row.expires_at,
      expired: row.state === 'pending' && Date.parse(row.expires_at) < now,
    })) as PendingInvite[],
  };

  commitSnapshot(ticket, snapshot);
  // Every walk on this trail, primed for the screen that opens next. The trail
  // is the only way into a walk, so by the time someone taps one its plan is
  // already known here — there is no reason for that screen to spend a round
  // trip re-learning the title and meeting point it could have drawn at once.
  for (const walk of snapshot.walks) primeOuting(walk, snapshot.pack);
  return snapshot;
}

/**
 * Seed a walk's screen with what the trail already knows about it.
 *
 * Marked `partial`, and that flag is load-bearing: attendance is genuinely
 * unknown here, so a screen painting this frame must stay quiet about who is
 * coming rather than claim nobody is. A real `loadOuting` overwrites it.
 *
 * With perf-walk-instant-open on and `roster` given (the meetup read carried
 * the walk's attendance), the seed is the WHOLE walk screen instead — the same
 * snapshot `community_outing` would return, composed by its own decoder (see
 * lib/community/outingDoc.ts). Still written optimistic, never fresh: the walk
 * screen refetches behind it on focus exactly as before. A server answer from
 * the last few seconds outranks it, and anything the composer cannot
 * reproduce exactly falls through to the partial seed below.
 */
export function primeOuting(
  walk: CommunityWalk,
  pack: CommunityPack,
  roster?: { members: readonly PackMember[]; attendance: readonly PackAttendanceEntry[] },
): void {
  const key = cacheKey.outing(walk.id);
  const existing = readSnapshot<OutingSnapshot>(key);
  if (roster && isPerfFlagOn('walkInstantOpen') && !(existing && !existing.partial && isFresh(key))) {
    let composed: OutingSnapshot | null = null;
    try {
      composed = composeOutingSnapshot({ walk, pack, members: roster.members, attendance: roster.attendance });
    } catch {
      // A malformed row must never fail the meetup's load; the old seed follows.
    }
    if (composed) {
      writeOptimistic(key, composed);
      return;
    }
  }
  // Never downgrade a complete snapshot back to a partial one.
  if (existing && !existing.partial) {
    // `walk` and `pack` here ARE freshly fetched, but the attendance being
    // carried over is not — so a re-prime must not restart its freshness
    // window. Bouncing between the trail and a walk re-primes on every visit,
    // and resetting each time would let a roster sit stale indefinitely while
    // looking current.
    const write = isFresh(key) ? writeSnapshot : writeOptimistic;
    write(key, { ...existing, walk, pack });
    return;
  }
  /**
   * Optimistic, NOT fresh — and the distinction is the whole reason this line
   * exists separately from the one above.
   *
   * This snapshot is a plan with nobody in it: `attendance: []`, `notAsked: []`,
   * `partial: true`. It is worth PAINTING, because arriving from the trail with
   * the title and meeting point already on screen beats arriving blank. It is
   * never worth trusting instead of the network, because the server has not
   * answered for this walk at all.
   *
   * Written with `writeSnapshot` it counted as fresh, and the walk screen's
   * focus gate skipped the fetch that would have filled it. The roster stayed
   * empty, no dog got selected, and "Start the walk" was disabled on every
   * planned walk — a screen that looked loaded and was not.
   *
   * Exactly the trap `rememberNewPack` documents two functions below. Any
   * writer that invents a value belongs here, not there.
   */
  writeOptimistic(key, { walk, pack, attendance: [], notAsked: [], partial: true });
}

/**
 * The most recent route each trail has actually walked.
 *
 * ── Why this exists, and why it is never awaited ────────────────────────────
 *
 * The Together map was empty. A planned walk has a meeting point and nothing
 * else, so the map carried three dots and no sense that these trails had ever
 * been anywhere — which made the whole surface read as a form rather than a
 * place. These are the real recorded routes from walks the pack has already
 * finished: the map fills with where you have been together, which is the only
 * honest thing it could fill with.
 *
 * Strictly decoration. Called after the trails are already on screen and
 * allowed to fail silently — a trail with no completed walk simply has no line,
 * which is true of every brand-new trail and must not look like an error.
 *
 * Deliberately off the critical path rather than folded into `listPacks`: a
 * line under a map is not worth delaying the list above it.
 *
 * One request since `community_trail_routes` (20261002050000): the latest
 * completed walk per trail and one route from it, under the caller's own RLS.
 * The three reads below remain for a database without the function. Any other
 * failure rejects rather than answering {}, so the caller keeps the lines it
 * already drew instead of wiping them for a network blip.
 */
export async function listTrailRoutes(
  packIds: string[],
): Promise<Record<string, { lat: number; lng: number }[]>> {
  if (!packIds.length) return {};

  const { data, error } = await supabase.rpc('community_trail_routes', { p_pack_ids: packIds });
  if (error && isMissingFunction(error.message)) return listTrailRoutesLegacy(packIds);
  if (error) throw new Error(error.message);

  const out: Record<string, { lat: number; lng: number }[]> = {};
  for (const row of (Array.isArray(data) ? data : []) as any[]) {
    const route = Array.isArray(row?.route) ? row.route : [];
    // The same test the three reads apply: a single fix is a dot, not a line.
    if (typeof row?.pack_id === 'string' && route.length > 1 && !out[row.pack_id]) out[row.pack_id] = route;
  }
  return out;
}

/**
 * What each of a meetup's finished walks draws as a card: cover photo, counts,
 * the longest leg, one thinned route per walker (20261007000000). Null on a
 * database without the function — the screen then draws its cards from the
 * walks alone. Any other failure rejects, so the caller keeps what it has.
 */
export async function listPackWalkCards(packId: string): Promise<WalkCard[] | null> {
  const { data, error } = await supabase.rpc('community_pack_walk_cards', { p_pack_id: packId, p_limit: 20 });
  if (error && isMissingFunction(error.message)) return null;
  if (error) throw new Error(error.message);
  return parseWalkCards(data);
}

/** The three-hop version, kept for a database without `community_trail_routes`. */
async function listTrailRoutesLegacy(
  packIds: string[],
): Promise<Record<string, { lat: number; lng: number }[]>> {
  const { data: done } = await supabase
    .from('community_walks')
    .select('id, pack_id, ended_at')
    .in('pack_id', packIds)
    .eq('state', 'completed')
    .order('ended_at', { ascending: false })
    .limit(TRAIL_ROUTE_SCAN_LIMIT);

  // Newest first, so the first walk seen for a pack is the one to draw. One
  // route per trail: a map with every walk a pack ever took is the gallery,
  // not this.
  const walkToPack = new Map<string, string>();
  for (const row of (done ?? []) as any[]) {
    if (!walkToPack.has(row.pack_id)) walkToPack.set(row.pack_id, row.id);
  }
  const walkIds = [...walkToPack.values()];
  if (!walkIds.length) return {};

  const { data: sessions } = await supabase
    .from('community_walk_sessions')
    .select('walk_id, walk_session_id')
    .in('walk_id', walkIds);
  const sessionIds = ((sessions ?? []) as any[]).map(row => row.walk_session_id);
  if (!sessionIds.length) return {};

  const { data: recorded } = await supabase
    .from('walk_sessions')
    .select('id, route')
    .in('id', sessionIds);

  const routeBySession = new Map<string, { lat: number; lng: number }[]>();
  for (const row of (recorded ?? []) as any[]) {
    const route = Array.isArray(row.route) ? row.route : [];
    // A single fix is a dot, not a line. Nothing to draw and nothing to say.
    if (route.length > 1) routeBySession.set(row.id, route);
  }

  const packByWalk = new Map<string, string>();
  for (const [packId, walkId] of walkToPack) packByWalk.set(walkId, packId);

  const out: Record<string, { lat: number; lng: number }[]> = {};
  for (const row of (sessions ?? []) as any[]) {
    const packId = packByWalk.get(row.walk_id);
    const route = routeBySession.get(row.walk_session_id);
    // First usable one wins: several people record the same outing, and their
    // lines are near-identical at this size.
    if (packId && route && !out[packId]) out[packId] = route;
  }
  return out;
}

export async function createOuting(input: {
  packId: string;
  title: string;
  scheduledFor: string | null;
  meetingLabel: string;
  note?: string;
}): Promise<CommunityWalk> {
  const { data, error } = await supabase.rpc('create_community_walk', {
    p_pack_id: input.packId,
    p_title: input.title.trim() || 'Pack walk',
    p_scheduled_for: input.scheduledFor,
    p_meeting_label: input.meetingLabel.trim(),
    p_note: input.note?.trim() || null,
  });
  return unwrap(data as CommunityWalk | null, error);
}

export interface OutingSnapshot {
  walk: CommunityWalk;
  pack: CommunityPack;
  /** People who were asked to this walk, with whatever they have answered. */
  attendance: WalkAttendance[];
  /**
   * Pack members nobody asked to this one.
   *
   * Kept separate rather than folded in as "invited", which is what this
   * function used to do. That merge predated walk invitations, when attendance
   * rows appeared only once somebody answered and the roster would otherwise
   * have looked empty. Now that being asked is an explicit act, inventing a row
   * for everyone made a walk with one guest look like a walk with the whole
   * pack waiting on it.
   *
   * They still belong on the screen — an uninvited member can join — but as
   * people who were not asked, not as people who have not replied.
   */
  notAsked: WalkAttendance[];
  /**
   * True when this is only the plan, seeded by `primeOuting` from the trail,
   * with the roster not yet fetched. See that function for why it matters.
   */
  partial?: boolean;
}

/**
 * One walk and everyone on it.
 *
 * Was seven queries in three serial waves, the first of which existed only to
 * learn `pack_id` — a whole round trip to Tokyo for one UUID. Now one call.
 *
 * The roster rule is unchanged and still the interesting part: it is the whole
 * accepted pack, not only people who have answered. Attendance rows are
 * created lazily, so reading that table alone made unanswered members vanish
 * from the pre-walk screen. A missing answer comes back as `invited` in
 * memory; nothing is written until that person actually responds.
 */
export async function loadOuting(walkId: string): Promise<OutingSnapshot> {
  const ticket = beginWrite(cacheKey.outing(walkId));
  const { data, error } = await supabase.rpc('community_outing', { p_walk_id: walkId });
  if (error) throw new Error(error.message);
  const snapshot = decodeOuting(walkId, data);
  commitSnapshot(ticket, snapshot);
  return snapshot;
}

export async function setAttendance(walkId: string, status: AttendanceStatus): Promise<void> {
  const userId = await currentUserId();
  if (!userId) throw new UserFacingError('Sign in to respond.');
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { walk_id: walkId, user_id: userId, status, updated_at: now };
  if (status === 'checked_in') patch.checked_in_at = now;
  if (status === 'walking') patch.joined_at = now;
  if (status === 'finished') patch.finished_at = now;
  const { error } = await supabase.from('community_walk_attendance').upsert(patch, { onConflict: 'walk_id,user_id' });
  if (error) throw new Error(error.message);
}

/**
 * Change a planned walk's time, meeting point or note.
 *
 * Only the organiser can, and only while it is still planned —
 * `community_walks_update_organizer` enforces the first and the `state` filter
 * the second. Moving a walk that is already underway would rewrite the plan out
 * from under people who are standing at the old meeting point.
 *
 * Touching `updated_at` is deliberate: `on_community_walk_changed` reads it to
 * build the dedupe key, so a second edit notifies the pack again rather than
 * being swallowed as a duplicate of the first.
 */
export async function updateOuting(input: {
  walkId: string;
  title: string;
  scheduledFor: string | null;
  meetingLabel: string;
  note?: string;
}): Promise<void> {
  const { error } = await supabase
    .from('community_walks')
    .update({
      title: input.title.trim() || 'Pack walk',
      scheduled_for: input.scheduledFor,
      meeting_label: input.meetingLabel.trim(),
      note: input.note?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.walkId)
    .eq('state', 'planned');
  if (error) throw new Error(error.message);
}

/**
 * Ask part of the pack to come to one walk.
 *
 * Seats them as `invited`, which the walk screen reads as "waiting for an
 * answer". Being invited is an ask, not a gate: anyone else in the pack still
 * sees this walk on the trail and can still join it.
 *
 * Re-inviting is safe — the RPC will not overwrite an answer someone has
 * already given. Returns how many people were newly asked.
 */
export async function inviteToWalk(walkId: string, userIds: string[]): Promise<number> {
  if (userIds.length === 0) return 0;
  const { data, error } = await supabase.rpc('invite_to_community_walk', {
    p_walk_id: walkId,
    p_user_ids: userIds,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

export async function startOuting(walkId: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('community_walks')
    .update({ state: 'active', started_at: now, updated_at: now })
    .eq('id', walkId)
    .eq('state', 'planned');
  if (error) throw new Error(error.message);
}

/** Plain sentences for what `join_community_walk` can refuse. */
export function joinErrorMessage(raw: string): string {
  if (raw.includes('walk_closed')) return 'This walk has finished.';
  if (raw.includes('pack_host_required')) return 'Only the host can start this walk.';
  if (raw.includes('walk_access_denied') || raw.includes('walk_not_found')) return 'This walk is no longer available to you.';
  if (raw.includes('pet_not_yours')) return 'Pick one of your own dogs for this walk.';
  if (raw.includes('auth_required')) return 'Sign in to join this walk.';
  if (raw.includes('update_required')) return 'This walk needs the latest Pawtchi. Update the app, then join.';
  return 'The walk could not start. Try again in a moment.';
}

/**
 * Join a walk — and, for the host, start it — in ONE transaction.
 *
 * This was three client writes in a row (attendance, then delete the dogs,
 * then insert them), four for a host: 3–4 round trips to Tokyo before
 * tracking could even begin, and a failure between them left attendance
 * saying "walking" with the dogs never saved. `join_community_walk`
 * (migration 20260926010000) does all of it atomically, with every permission
 * the old RLS policies enforced restated inside it.
 *
 * Falls back to the old writes only when the function is not on this database
 * yet — an app build that has outrun its migration.
 */
export async function joinOuting(
  walkId: string,
  petIds: string[],
  shareLocation: boolean,
  options: { start?: boolean } = {},
): Promise<void> {
  // v2 (20261004010000): this build speaks live protocol 2, and asks for the
  // Broadcast transport only when Live Walk v2 is on for it. The server still
  // decides — with Broadcast switched off server-side every walk is `db`.
  const v2 = await supabase.rpc('join_community_walk_v2', {
    p_walk_id: walkId,
    p_pet_ids: petIds,
    p_share_location: shareLocation,
    p_start: !!options.start,
    p_live_protocol: LIVE_PROTOCOL,
    p_request_broadcast: isPerfFlagOn('liveWalkV2') && isPerfFlagOn('liveWalkBroadcast'),
  });
  const { error } = v2.error && isMissingFunction(v2.error.message)
    ? await supabase.rpc('join_community_walk', {
      p_walk_id: walkId,
      p_pet_ids: petIds,
      p_share_location: shareLocation,
      p_start: !!options.start,
    })
    : v2;
  if (!error) return;
  if (!isMissingFunction(error.message)) {
    // A refusal is the walk's answer and gets its own sentence. A dropped
    // connection or a busy server is not an answer: it keeps its kind, so the
    // screen can say what happened — and retry, since joining is idempotent.
    if (isTransientError(new Error(error.message))) throw new Error(error.message);
    throw new UserFacingError(joinErrorMessage(error.message));
  }
  if (options.start) await startOuting(walkId);
  await joinOutingLegacy(walkId, petIds, shareLocation);
}

async function joinOutingLegacy(walkId: string, petIds: string[], shareLocation: boolean): Promise<void> {
  const userId = await currentUserId();
  if (!userId) throw new UserFacingError('Sign in to join this walk.');
  const now = new Date().toISOString();
  const { error: attendanceError } = await supabase.from('community_walk_attendance').upsert(
    {
      walk_id: walkId,
      user_id: userId,
      status: 'walking',
      share_location: shareLocation,
      joined_at: now,
      updated_at: now,
    },
    { onConflict: 'walk_id,user_id' },
  );
  if (attendanceError) throw new Error(attendanceError.message);
  const { error: removeError } = await supabase
    .from('community_walk_participant_pets')
    .delete()
    .eq('walk_id', walkId)
    .eq('user_id', userId);
  if (removeError) throw new Error(removeError.message);
  if (petIds.length) {
    const { error } = await supabase.from('community_walk_participant_pets').insert(
      petIds.map(petId => ({ walk_id: walkId, user_id: userId, pet_id: petId })),
    );
    if (error) throw new Error(error.message);
  }
}

export async function linkPersonalWalk(input: {
  communityWalkId: string;
  personalWalkId: string;
  petId: string;
}): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  const { error } = await supabase.from('community_walk_sessions').upsert(
    {
      walk_id: input.communityWalkId,
      user_id: userId,
      pet_id: input.petId,
      walk_session_id: input.personalWalkId,
    },
    { onConflict: 'walk_id,user_id,walk_session_id' },
  );
  if (error) throw new Error(error.message);
}

export async function publishLiveLocation(
  walkId: string,
  point: { lat: number; lng: number; accuracy?: number | null; timestamp?: number },
  path: { lat: number; lng: number }[] = [],
): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  const { error } = await supabase.from('community_live_locations').upsert(
    {
      walk_id: walkId,
      user_id: userId,
      lat: point.lat,
      lng: point.lng,
      accuracy_m: point.accuracy ?? null,
      path,
      recorded_at: new Date(point.timestamp ?? Date.now()).toISOString(),
    },
    { onConflict: 'walk_id,user_id' },
  );
  if (error) throw new Error(error.message);
}

export async function listLiveParties(walkId: string): Promise<LiveParty[]> {
  const { data, error } = await supabase
    .from('community_live_locations')
    .select('*')
    .eq('walk_id', walkId)
    .order('recorded_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as LiveParty[];
}

export async function finishCommunityParticipation(walkId: string): Promise<void> {
  await setAttendance(walkId, 'finished');
}

export async function closeOuting(walkId: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('community_walks')
    .update({ state: 'completed', ended_at: now, updated_at: now })
    .eq('id', walkId);
  if (error) throw new Error(error.message);
}

/**
 * The shared walk memory: the traces, the moments and who walked.
 *
 * Was eight queries in FIVE waves — and two of those waves were serial for no
 * reason at all, because hearts and routes do not depend on each other and
 * were simply awaited one after the other. One round trip now.
 *
 * Routes come back whole. They are small today (17 points on average) and this
 * screen draws every walker's line, so there is nothing worth trimming yet;
 * when a real 45-minute walk lands here at ~900 points, simplify in SQL before
 * it crosses the wire rather than after.
 */
export async function loadMemory(walkId: string): Promise<CommunityMemory> {
  const ticket = beginWrite(cacheKey.outing(walkId));
  const { data, error } = await supabase.rpc('community_memory', { p_walk_id: walkId });
  if (error) throw new Error(error.message);

  const doc = (data ?? {}) as {
    outing?: unknown;
    moments?: SharedMoment[];
    sessions?: {
      user_id: string;
      walk_session_id: string;
      route: unknown;
      distance_m: unknown;
      duration_s: unknown;
      sniff_points: unknown;
    }[];
  };

  // The outing half is the identical document `community_outing` returns, so
  // it is decoded by the same code rather than a second copy of the rules
  // about lazily-created attendance rows.
  const snapshot = decodeOuting(walkId, doc.outing);
  commitSnapshot(ticket, snapshot);

  const sessions = doc.sessions ?? [];
  const sessionIds = sessions.map(row => row.walk_session_id);
  // One trace per person, not one per link — see mergeTraces for the four-row
  // walker this was written for.
  const traces = mergeTraces(
    sessions.map(row => ({ user_id: row.user_id, walk_session_id: row.walk_session_id })),
    sessions.map(row => ({
      id: row.walk_session_id,
      route: row.route,
      distance_m: row.distance_m,
      duration_s: row.duration_s,
      sniff_points: row.sniff_points,
    })),
  );

  return {
    walk: snapshot.walk,
    pack: snapshot.pack,
    attendance: snapshot.attendance,
    moments: (doc.moments ?? []) as SharedMoment[],
    sessionIds,
    routes: sessions
      .map(row => (Array.isArray(row.route) ? (row.route as { lat: number; lng: number }[]) : []))
      .filter(route => route.length > 0),
    traces,
  };
}

export async function setMomentHeart(mediaId: string, hearted: boolean): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  const query = hearted
    ? supabase.from('community_media_hearts').upsert({ media_id: mediaId, user_id: userId })
    : supabase.from('community_media_hearts').delete().eq('media_id', mediaId).eq('user_id', userId);
  const { error } = await query;
  if (error) throw new Error(error.message);
}

export async function removeSharedMoment(mediaId: string): Promise<void> {
  const { error } = await supabase
    .from('community_shared_media')
    .update({ removed_at: new Date().toISOString() })
    .eq('id', mediaId);
  if (error) throw new Error(error.message);
}


export async function setPackMuted(packId: string, muted: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_community_pack_muted', {
    p_pack_id: packId,
    p_muted: muted,
  });
  if (error) throw new Error(error.message);
}

export async function removePackMember(packId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('community_pack_members')
    .delete()
    .eq('pack_id', packId)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
}

export async function leavePack(packId: string): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  await removePackMember(packId, userId);
}

export async function transferPackOwnership(packId: string, newOwnerId: string): Promise<void> {
  const { error } = await supabase.rpc('transfer_community_pack_ownership', {
    p_pack_id: packId,
    p_new_owner_id: newOwnerId,
  });
  if (error) throw new Error(error.message);
}

export async function blockAndReportUser(input: {
  userId: string;
  packId?: string;
  reason: 'unwanted_invitation' | 'harassment' | 'unsafe_content' | 'other';
  details?: string;
}): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  const [block, report] = await Promise.all([
    supabase.from('community_user_blocks').upsert({ blocker_id: userId, blocked_id: input.userId }),
    supabase.from('community_reports').insert({
      reporter_id: userId,
      reported_user_id: input.userId,
      pack_id: input.packId ?? null,
      reason: input.reason,
      details: input.details?.trim() || null,
    }),
  ]);
  if (block.error) throw new Error(block.error.message);
  if (report.error) throw new Error(report.error.message);
}
