import { supabase } from './supabase';
import { cacheKey, readSnapshot, writeSnapshot } from './communityCache';
import { currentUserId } from './sessionUser';
import { isValidUsername, normalizeUsername } from './communityUsername';
import { mergeTraces } from './community/memoryTraces';

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

function unwrap<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  if (data === null) throw new Error('Nothing was returned.');
  return data;
}

export async function getMyUsername(): Promise<string | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.username as string | null | undefined) ?? null;
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
    throw new Error('Use 3–24 lowercase letters, numbers or underscores.');
  }
  const userId = await currentUserId();
  if (!userId) throw new Error('Sign in to choose a username.');
  const { error } = await supabase.from('profiles').update({ username }).eq('id', userId);
  if (error) {
    if (error.code === '23505') throw new Error('That username is already taken.');
    throw new Error(error.message);
  }
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

/**
 * How many recent walks are scanned for a trail cover photo, across all of an
 * owner's trails. A trail whose last photo is older than this shows its map
 * instead, which is the same thing a trail with no photo at all shows.
 */
const COVER_WALK_SCAN_LIMIT = 150;

/**
 * Statuses that mean "I am coming". `invited` is not one of them — being asked
 * is not an answer, and counting it as one is how a walk nobody replied to
 * claims a full turnout.
 */
const COMING_STATUSES: AttendanceStatus[] = ['coming', 'checked_in', 'walking', 'finished'];

/** How many of this owner's own answers are read to badge the trail list. */
const MY_ATTENDANCE_LIMIT = 500;

/** Unanswered walk invitations read for the waiting pill. */
const WALK_INVITE_LIMIT = 50;

/** Completed walks scanned to find one drawable route per trail. */
const TRAIL_ROUTE_SCAN_LIMIT = 60;

export async function listPacks(): Promise<CommunityPack[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  const { data: memberships, error } = await supabase
    .from('community_pack_members')
    .select('pack_id, role, community_packs(*)')
    .eq('user_id', userId)
    .order('joined_at', { ascending: false });
  if (error) throw new Error(error.message);
  const packs = (memberships ?? []).map((row: any) => ({
    ...(Array.isArray(row.community_packs) ? row.community_packs[0] : row.community_packs),
    role: row.role,
  })) as CommunityPack[];
  if (!packs.length) return [];

  const packIds = packs.map(pack => pack.id);
  const now = new Date().toISOString();
  const [{ data: members }, { data: walks }, { data: allWalkIds }, { data: myRows }] = await Promise.all([
    supabase.from('community_pack_members').select('pack_id, user_id').in('pack_id', packIds),
    supabase
      .from('community_walks')
      .select('*')
      .in('pack_id', packIds)
      .in('state', ['planned', 'active'])
      .or(`scheduled_for.gte.${now},scheduled_for.is.null`)
      .order('scheduled_for', { ascending: true, nullsFirst: true }),
    // Walks the cover could come from — the ones that have already happened,
    // which the query above deliberately excludes.
    //
    // Capped, and the cap is about the NEXT query rather than this one: those
    // ids become an `IN` list in a URL, and an owner with a few well-walked
    // trails would otherwise build one several kilobytes long and eventually
    // meet a 414. Newest first, because a cover is the newest photo and a photo
    // is published when a walk ends — so the walks that could supply one are
    // the recent ones by construction.
    supabase
      .from('community_walks')
      .select('id, pack_id')
      .in('pack_id', packIds)
      .order('created_at', { ascending: false })
      .limit(COVER_WALK_SCAN_LIMIT),
    // My own answers, every one of them, matched to walks in memory below.
    //
    // Fetched by user rather than by walk on purpose: keying it on walk ids
    // would make it wait for the query above, and this is the badge on a list
    // row — not worth a second round trip. These are only ever this owner's
    // rows, so the set is bounded by how many walks they have been asked to.
    supabase
      .from('community_walk_attendance')
      .select('walk_id, status')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(MY_ATTENDANCE_LIMIT),
  ]);

  // Newest contributed photo per pack, in one round trip rather than one per
  // card. `removed_at` is respected here as everywhere — a contributor who
  // withdrew a photo must not find it still fronting the trail.
  const walkToPack = new Map<string, string>();
  for (const row of (allWalkIds ?? []) as any[]) walkToPack.set(row.id, row.pack_id);
  const coverByPack = new Map<string, string>();
  // Who has said yes to each upcoming walk. Rides alongside the cover lookup
  // rather than behind it — both need walk ids and neither needs the other.
  const upcomingIds = ((walks ?? []) as CommunityWalk[]).map(walk => walk.id);
  const goingByWalk = new Map<string, number>();

  const memberIds = Array.from(new Set(((members ?? []) as any[]).map(row => row.user_id)));
  const [{ data: media }, { data: going }, { data: memberDogs }, { data: memberProfiles }] = await Promise.all([
    walkToPack.size > 0
      ? supabase
          .from('community_shared_media')
          .select('walk_id, display_path, captured_at')
          .in('walk_id', [...walkToPack.keys()])
          .not('display_path', 'is', null)
          .is('removed_at', null)
          .order('captured_at', { ascending: false })
      : Promise.resolve({ data: [] as any[] }),
    upcomingIds.length
      ? supabase
          .from('community_walk_attendance')
          .select('walk_id, status')
          .in('walk_id', upcomingIds)
          .in('status', COMING_STATUSES)
      : Promise.resolve({ data: [] as any[] }),
    // The faces on every card. Same stage as the two above — all three need
    // ids that stage one produced, and none of them needs the others.
    memberIds.length
      ? supabase
          .from('pets')
          .select('id, owner_id, name, image_url')
          .eq('species', 'dog')
          .in('owner_id', memberIds)
      : Promise.resolve({ data: [] as any[] }),
    memberIds.length
      ? supabase.from('profiles').select('id, full_name, username').in('id', memberIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  for (const row of (media ?? []) as any[]) {
    const packId = walkToPack.get(row.walk_id);
    // Ordered newest-first, so the first one seen for a pack is its cover.
    if (packId && !coverByPack.has(packId)) coverByPack.set(packId, row.display_path);
  }
  for (const row of (going ?? []) as any[]) {
    goingByWalk.set(row.walk_id, (goingByWalk.get(row.walk_id) ?? 0) + 1);
  }
  const myStatusByWalk = new Map<string, AttendanceStatus>(
    ((myRows ?? []) as any[]).map(row => [row.walk_id, row.status as AttendanceStatus]),
  );
  // Which owners belong to which pack, so a pack's dogs are its own.
  const ownersByPack = new Map<string, string[]>();
  for (const row of (members ?? []) as any[]) {
    ownersByPack.set(row.pack_id, [...(ownersByPack.get(row.pack_id) ?? []), row.user_id]);
  }
  const dogsByOwner = new Map<string, CommunityDog[]>();
  for (const dog of (memberDogs ?? []) as any[]) {
    dogsByOwner.set(dog.owner_id, [...(dogsByOwner.get(dog.owner_id) ?? []), dog as CommunityDog]);
  }
  const nameById = new Map<string, string | null>(
    ((memberProfiles ?? []) as any[]).map(row => [
      row.id,
      // A first name, because this reads as "Mira hosts" in a sentence.
      (row.full_name as string | null)?.trim().split(/\s+/)[0]
        || (row.username ? `@${row.username}` : null),
    ]),
  );

  const resolved = packs.map(pack => {
    const nextWalk = ((walks ?? []) as CommunityWalk[]).find(walk => walk.pack_id === pack.id) ?? null;
    return {
      ...pack,
      memberCount: (members ?? []).filter((member: any) => member.pack_id === pack.id).length,
      nextWalk,
      coverPath: coverByPack.get(pack.id) ?? null,
      goingCount: nextWalk ? goingByWalk.get(nextWalk.id) ?? 0 : 0,
      myStatus: nextWalk ? myStatusByWalk.get(nextWalk.id) ?? null : null,
      dogs: (ownersByPack.get(pack.id) ?? []).flatMap(owner => dogsByOwner.get(owner) ?? []),
      hostName: nextWalk ? nameById.get(nextWalk.organizer_id) ?? null : null,
    };
  });
  writeSnapshot(cacheKey.packs(), resolved);
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
  writeSnapshot(cacheKey.packs(), [entry, ...existing.filter(row => row.id !== pack.id)]);
}

export async function createPack(name: string): Promise<CommunityPack> {
  const clean = name.trim();
  if (clean.length < 2) throw new Error('Give the pack a name.');
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
  const { data, error } = await supabase
    .from('community_walk_attendance')
    .select('walk_id, community_walks!inner(id, pack_id, title, scheduled_for, meeting_label, state)')
    .eq('user_id', userId)
    .eq('status', 'invited')
    .limit(WALK_INVITE_LIMIT);
  if (error) throw new Error(error.message);

  const rows = ((data ?? []) as any[])
    .map(row => (Array.isArray(row.community_walks) ? row.community_walks[0] : row.community_walks))
    .filter(walk => walk && (walk.state === 'planned' || walk.state === 'active'));
  if (!rows.length) return [];

  const packIds = Array.from(new Set(rows.map((walk: any) => walk.pack_id)));
  const { data: packs } = await supabase
    .from('community_packs')
    .select('id, name')
    .in('id', packIds);
  const nameById = new Map<string, string>(((packs ?? []) as any[]).map(p => [p.id, p.name]));

  return rows.map((walk: any) => ({
    walkId: walk.id,
    packId: walk.pack_id,
    packName: nameById.get(walk.pack_id) ?? 'A trail',
    title: walk.title,
    scheduledFor: walk.scheduled_for,
    meetingLabel: walk.meeting_label,
  }));
}

export async function respondToInvitation(invitationId: string, accept: boolean): Promise<void> {
  const { data, error } = await supabase.rpc('respond_community_invitation', {
    p_invitation_id: invitationId,
    p_accept: accept,
  });
  if (error) throw new Error(error.message);
  if (data === 'not_available') throw new Error('That invitation is no longer available.');
}

export async function inviteUsername(packId: string, username: string): Promise<CommunityInvitation> {
  const { data, error } = await supabase.rpc('invite_community_username', {
    p_pack_id: packId,
    p_username: normalizeUsername(username),
  });
  return unwrap(data as CommunityInvitation | null, error);
}

export async function createExternalInvite(packId: string): Promise<CommunityInvitation> {
  const { data, error } = await supabase.rpc('create_external_community_invite', {
    p_pack_id: packId,
  });
  return unwrap(data as CommunityInvitation | null, error);
}

export async function claimExternalInvite(code: string): Promise<'host_confirmation_required' | 'invalid_or_expired'> {
  const { data, error } = await supabase.rpc('claim_external_community_invite', { p_code: code.trim() });
  if (error) throw new Error(error.message);
  return data as 'host_confirmation_required' | 'invalid_or_expired';
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

export async function approveExternalInvite(invitationId: string, approve: boolean): Promise<void> {
  const { data, error } = await supabase.rpc('approve_external_community_invite', {
    p_invitation_id: invitationId,
    p_approve: approve,
  });
  if (error) throw new Error(error.message);
  if (data === 'not_available') throw new Error('That request is no longer available.');
}

export interface PackSnapshot {
  pack: CommunityPack;
  members: PackMember[];
  walks: CommunityWalk[];
  invited: PendingInvite[];
}

export async function loadPack(packId: string): Promise<PackSnapshot> {
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
  const [{ data: profiles }, { data: dogs }, { data: invitedRows }] = await Promise.all([
    ids.length
      ? supabase.from('profiles').select('id, username, full_name, avatar_url').in('id', ids)
      : Promise.resolve({ data: [] as any[] }),
    ids.length
      ? supabase.from('pets').select('id, owner_id, name, image_url').eq('species', 'dog').in('owner_id', ids)
      : Promise.resolve({ data: [] as any[] }),
    supabase.rpc('list_pack_invitations', { p_pack_id: packId }),
  ]);

  // Who has been asked but has not answered. Through an RPC because the host
  // cannot read a pending invitee's profile directly — every profiles policy
  // needs a shared pack, and that is precisely what an invitation has not
  // created yet. See 20260917999998_pack_invitation_roster.sql.
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

  writeSnapshot(cacheKey.pack(packId), snapshot);
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
 */
export function primeOuting(walk: CommunityWalk, pack: CommunityPack): void {
  const key = cacheKey.outing(walk.id);
  const existing = readSnapshot<OutingSnapshot>(key);
  // Never downgrade a complete snapshot back to a partial one.
  if (existing && !existing.partial) {
    writeSnapshot(key, { ...existing, walk, pack });
    return;
  }
  writeSnapshot(key, { walk, pack, attendance: [], notAsked: [], partial: true });
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
 * Three hops, deliberately off the critical path rather than folded into
 * `listPacks`: a line under a map is not worth delaying the list above it.
 */
export async function listTrailRoutes(
  packIds: string[],
): Promise<Record<string, { lat: number; lng: number }[]>> {
  if (!packIds.length) return {};

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

export async function loadOuting(walkId: string): Promise<OutingSnapshot> {
  const { data: walk, error: walkError } = await supabase
    .from('community_walks')
    .select('*')
    .eq('id', walkId)
    .single();
  if (walkError) throw new Error(walkError.message);
  const [
    { data: pack, error: packError },
    { data: attendance, error: attendanceError },
    { data: memberRows, error: memberError },
  ] = await Promise.all([
    supabase.from('community_packs').select('*').eq('id', walk.pack_id).single(),
    supabase.from('community_walk_attendance').select('*').eq('walk_id', walkId).order('updated_at'),
    supabase
      .from('community_pack_members')
      .select('user_id')
      .eq('pack_id', walk.pack_id)
      .order('joined_at'),
  ]);
  if (packError) throw new Error(packError.message);
  if (attendanceError) throw new Error(attendanceError.message);
  if (memberError) throw new Error(memberError.message);

  // The outing roster is the whole accepted pack, not just people who have
  // already answered. Attendance rows are intentionally created lazily, so a
  // query of that table alone made unanswered members disappear from the
  // pre-walk screen. Merge the pack roster with those rows and represent a
  // missing answer as `invited` in memory; the database remains unchanged
  // until that person responds.
  const ids = Array.from(new Set([
    ...(memberRows ?? []).map((row: any) => row.user_id),
    ...(attendance ?? []).map((row: any) => row.user_id),
  ]));
  const [{ data: profiles }, { data: participantDogs }, { data: packDogs }] = ids.length
    ? await Promise.all([
        supabase.from('profiles').select('id, username, full_name, avatar_url').in('id', ids),
        supabase.from('community_walk_participant_pets').select('user_id, pets(id, owner_id, name, image_url)').eq('walk_id', walkId),
        supabase.from('pets').select('id, owner_id, name, image_url').eq('species', 'dog').in('owner_id', ids),
      ])
    : [{ data: [] as any[] }, { data: [] as any[] }, { data: [] as any[] }];

  const attendanceByUser = new Map((attendance ?? []).map((row: any) => [row.user_id, row]));
  const decorate = (userId: string, row: any): WalkAttendance => {
    const selectedDogs = (participantDogs ?? [])
      .filter((entry: any) => entry.user_id === userId)
      .flatMap((entry: any) => Array.isArray(entry.pets) ? entry.pets : [entry.pets])
      .filter(Boolean);
    return {
      walk_id: walkId,
      user_id: userId,
      status: 'invited',
      share_location: false,
      checked_in_at: null,
      joined_at: null,
      finished_at: null,
      updated_at: walk.created_at,
      ...row,
      person: (profiles ?? []).find((profile: any) => profile.id === userId),
      dogs: selectedDogs.length
        ? selectedDogs
        : (packDogs ?? []).filter((dog: any) => dog.owner_id === userId),
    } as WalkAttendance;
  };

  const snapshot: OutingSnapshot = {
    walk: walk as CommunityWalk,
    pack: pack as CommunityPack,
    attendance: ids
      .filter(id => attendanceByUser.has(id))
      .map(id => decorate(id, attendanceByUser.get(id))),
    notAsked: ids
      .filter(id => !attendanceByUser.has(id))
      .map(id => decorate(id, null)),
  };
  writeSnapshot(cacheKey.outing(walkId), snapshot);
  return snapshot;
}

export async function setAttendance(walkId: string, status: AttendanceStatus): Promise<void> {
  const userId = await currentUserId();
  if (!userId) throw new Error('Sign in to respond.');
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

export async function joinOuting(walkId: string, petIds: string[], shareLocation: boolean): Promise<void> {
  const userId = await currentUserId();
  if (!userId) throw new Error('Sign in to join this walk.');
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

export async function loadMemory(walkId: string): Promise<CommunityMemory> {
  const [{ walk, pack, attendance }, { data: moments, error: momentError }, { data: sessions, error: sessionError }] =
    await Promise.all([
      loadOuting(walkId),
      supabase.from('community_shared_media').select('*').eq('walk_id', walkId).is('removed_at', null).order('captured_at'),
      supabase.from('community_walk_sessions').select('user_id, walk_session_id').eq('walk_id', walkId),
    ]);
  if (momentError) throw new Error(momentError.message);
  if (sessionError) throw new Error(sessionError.message);
  const mediaIds = (moments ?? []).map((row: any) => row.id);
  const userId = await currentUserId();
  const { data: hearts } = mediaIds.length
    ? await supabase.from('community_media_hearts').select('media_id, user_id').in('media_id', mediaIds)
    : { data: [] as any[] };
  // The routes are the participants' own recordings, fetched by id rather than
  // redrawn: the memory shows what each phone actually measured, and an outing
  // whose members never started a walk simply has none.
  const sessionIds = (sessions ?? []).map((row: any) => row.walk_session_id);
  const { data: personalWalks } = sessionIds.length
    ? await supabase
        .from('walk_sessions')
        .select('id, route, distance_m, duration_s, sniff_points')
        .in('id', sessionIds)
    : { data: [] as any[] };

  // One trace per person, not one per link — see mergeTraces for the four-row
  // walker this was written for.
  const traces = mergeTraces(
    ((sessions ?? []) as any[]).map(row => ({ user_id: row.user_id, walk_session_id: row.walk_session_id })),
    ((personalWalks ?? []) as any[]),
  );
  return {
    walk,
    pack,
    attendance,
    moments: (moments ?? []).map((moment: any) => ({
      ...moment,
      heartCount: (hearts ?? []).filter((heart: any) => heart.media_id === moment.id).length,
      heartedByMe: (hearts ?? []).some((heart: any) => heart.media_id === moment.id && heart.user_id === userId),
    })) as SharedMoment[],
    sessionIds,
    routes: (personalWalks ?? []).map((row: any) => Array.isArray(row.route) ? row.route : []).filter((route: any[]) => route.length > 0),
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

/**
 * The same walk again, meeting point and all.
 *
 * The coordinate is carried across deliberately. `create_community_walk` takes
 * only a label, so without this second write a repeat walk kept the words and
 * silently lost the pin — the one thing about "walk again" that is supposed to
 * be identical would have quietly degraded every time it was used.
 */
export async function walkAgain(walk: CommunityWalk): Promise<CommunityWalk> {
  const next = await createOuting({
    packId: walk.pack_id,
    title: walk.title,
    scheduledFor: null,
    meetingLabel: walk.meeting_label,
    note: walk.note ?? undefined,
  });
  if (walk.meeting_lat != null && walk.meeting_lng != null) {
    // Best-effort, like every other pin write: the walk is already real, and
    // losing the coordinate costs a map on a card, not the plan.
    await setOutingMeetingPoint(next.id, walk.meeting_lat, walk.meeting_lng).catch(() => {});
  }
  return next;
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
