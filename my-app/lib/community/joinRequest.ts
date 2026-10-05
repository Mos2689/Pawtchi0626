/**
 * Words for a join request: someone opened a meetup's invite link and is
 * waiting for the host to confirm them. Pure, so the card's copy is tested.
 */

import type { ExternalInviteClaim } from '../communityWalks';

/** The name a host knows them by: full name, else @username, else a fallback. */
export function requesterName(claim: Pick<ExternalInviteClaim, 'full_name' | 'username'>): string {
  const full = claim.full_name?.trim();
  if (full) return full;
  if (claim.username) return `@${claim.username}`;
  return 'Someone';
}

/** "Opened your invite link 12 min ago" — when, so a host can match it to who they sent it to. */
export function requestedLine(claimedAt: string | null | undefined, now: number): string {
  const at = claimedAt ? Date.parse(claimedAt) : Number.NaN;
  if (!Number.isFinite(at)) return 'Opened your invite link';
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 2) return 'Opened your invite link just now';
  if (minutes < 60) return `Opened your invite link ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Opened your invite link ${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'Opened your invite link yesterday' : `Opened your invite link ${days} days ago`;
}

/** "Walks with Olive & Max", or a plain note when there is no dog profile. */
export function requesterDogs(claim: Pick<ExternalInviteClaim, 'dogs'>): string {
  const names = claim.dogs.map(dog => dog.name).filter(Boolean);
  return names.length ? `Walks with ${names.join(' & ')}` : 'No dog profile yet';
}
