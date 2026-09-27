/**
 * What someone sees about a meetup before accepting an invitation to it.
 *
 * Fetched per invitation from `community_invitation_preview` (migration
 * 20260926020000), which only answers the person the invitation was sent to,
 * and only while it is pending. This file shapes the answer and words it.
 */

import { dateFormat } from '../dateFormats';

export interface InvitationPreview {
  packName: string;
  hostName: string | null;
  memberCount: number;
  dogs: { id: string; name: string; image_url: string | null }[];
  nextWalk: {
    title: string;
    live: boolean;
    scheduledFor: string | null;
    meetingLabel: string | null;
    note: string | null;
    goingCount: number;
  } | null;
}

export function toInvitationPreview(raw: unknown): InvitationPreview | null {
  const doc = raw as Record<string, any> | null;
  if (!doc || typeof doc.packName !== 'string') return null;
  const walk = doc.nextWalk as Record<string, any> | null;
  return {
    packName: doc.packName,
    hostName: typeof doc.hostName === 'string' && doc.hostName.trim() ? doc.hostName : null,
    memberCount: Number(doc.memberCount) || 0,
    dogs: Array.isArray(doc.dogs) ? doc.dogs : [],
    nextWalk: walk
      ? {
          title: typeof walk.title === 'string' ? walk.title : 'Pack walk',
          live: walk.state === 'active',
          scheduledFor: typeof walk.scheduledFor === 'string' ? walk.scheduledFor : null,
          meetingLabel: typeof walk.meetingLabel === 'string' && walk.meetingLabel.trim() ? walk.meetingLabel : null,
          note: typeof walk.note === 'string' && walk.note.trim() ? walk.note : null,
          goingCount: Number(walk.goingCount) || 0,
        }
      : null,
  };
}

/** "Sam hosts · 4 people · 3 dogs". */
export function previewPeopleLine(preview: InvitationPreview): string {
  const parts: string[] = [];
  if (preview.hostName) parts.push(`${preview.hostName} hosts`);
  parts.push(`${preview.memberCount} ${preview.memberCount === 1 ? 'person' : 'people'}`);
  if (preview.dogs.length) parts.push(`${preview.dogs.length} ${preview.dogs.length === 1 ? 'dog' : 'dogs'}`);
  return parts.join(' · ');
}

/** "Walking now", "Sunday 7:15 AM", or "Date to be confirmed". */
export function previewWhen(walk: NonNullable<InvitationPreview['nextWalk']>): string {
  if (walk.live) return 'Walking now';
  if (!walk.scheduledFor) return 'Date to be confirmed';
  const at = new Date(walk.scheduledFor);
  if (Number.isNaN(at.getTime())) return 'Date to be confirmed';
  return dateFormat({ weekday: 'long', hour: 'numeric', minute: '2-digit' }).format(at);
}

/** "2 going", or null when nobody has said yet. */
export function previewGoing(walk: NonNullable<InvitationPreview['nextWalk']>): string | null {
  return walk.goingCount > 0 ? `${walk.goingCount} going` : null;
}

/** A sentence for a preview that cannot be shown. */
export function previewErrorMessage(raw: string): string {
  if (raw.includes('invitation_not_available')) return 'This invitation is no longer open.';
  return 'The details could not load. You can still answer.';
}
