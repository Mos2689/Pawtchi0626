/**
 * People a host has invited before, offered back to them on the invite screen.
 *
 * Only ever the host's OWN history: the list and the send are both derived on
 * the server from invitations this host sent (migration
 * 20260924000000_previous_invitees). Nothing here can widen who a host can
 * reach — that is what keeps a private meetup private, and why the screen still
 * has no search. This file only shapes the rows and the wording.
 */

import type { CommunityDog } from '../communityWalks';

export interface PreviousInvitee {
  id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  dogs: CommunityDog[];
  lastInvitedAt: string | null;
  /** Already holds a live invitation to THIS meetup — shown, not selectable. */
  pendingHere: boolean;
}

/** The server caps a send at the hourly invitation budget. */
export const MAX_PREVIOUS_INVITE_BATCH = 12;

export function toPreviousInvitee(row: Record<string, unknown>): PreviousInvitee | null {
  const id = typeof row.user_id === 'string' ? row.user_id : null;
  if (!id) return null;
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null);
  return {
    id,
    username: text(row.username),
    full_name: text(row.full_name),
    avatar_url: text(row.avatar_url),
    dogs: Array.isArray(row.dogs) ? (row.dogs as CommunityDog[]) : [],
    lastInvitedAt: text(row.last_invited_at),
    pendingHere: row.pending_here === true,
  };
}

/** The line a row leads with: the dogs, since this is a dogs' app, then the owner. */
export function inviteeTitle(person: PreviousInvitee): string {
  const dogs = person.dogs.map(dog => dog.name).filter(Boolean);
  if (dogs.length) return dogs.join(' & ');
  return person.full_name ?? (person.username ? `@${person.username}` : 'A Pawtchi owner');
}

export function inviteeSubtitle(person: PreviousInvitee): string {
  const handle = person.username ? `@${person.username}` : null;
  const owner = person.dogs.length && person.full_name ? person.full_name.trim().split(/\s+/)[0] : null;
  return [owner, handle].filter(Boolean).join(' · ') || 'Invited before';
}

/** Label for the send button. */
export function inviteSelectedLabel(count: number, sending: boolean): string {
  if (sending) return 'Inviting…';
  if (count === 0) return 'Choose who to invite';
  return count === 1 ? 'Invite 1 person' : `Invite ${count} people`;
}

/** Plain sentences for the errors the two functions can raise. */
export function previousInviteError(raw: string): string {
  if (raw.includes('invite_rate_limited')) {
    return 'That is more invitations than an hour allows. Send a few now and the rest later.';
  }
  if (raw.includes('pack_host_required')) {
    return 'Only the host can invite people to this meetup.';
  }
  if (raw.includes('not_a_previous_invitee')) {
    return 'Someone on that list can no longer be invited from here. The list has been refreshed.';
  }
  return 'The invitations could not be sent. Try again in a moment.';
}

/**
 * Whether the function is simply not on this database yet — an app build that
 * has outrun its migration. The section hides rather than showing an error for
 * a feature that is not there.
 */
export function isMissingFunction(raw: string): boolean {
  return /could not find the function|PGRST202|does not exist/i.test(raw);
}
