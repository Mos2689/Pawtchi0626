/**
 * The message a host pastes into a chat to invite somebody to a trail.
 *
 * ── Why this is a module and not a template literal ────────────────────────
 *
 * It is the only copy in this app that lands somewhere we do not control, in
 * front of somebody who has never heard of us, with no way to correct it after
 * it is sent. It is also the whole of the first impression: for most invitees
 * this text IS Pawtchi until they tap the link.
 *
 * What it shipped as:
 *
 *   Join Sept Salty Walk on Pawtchi so we can plan a walk and make a shared
 *   memory.
 *   https://pawtchi.com/app/community-invite?code=80d6cc6f-…
 *   Invitation code: 80d6cc6f-d9e9-4287-b95f-2e4409111fcd
 *
 * Three problems. Nobody sent it — "Join … so we can" is written in a voice
 * with no name attached, and a stranger reading it cannot tell whether their
 * friend sent it or a robot did. It says nothing about the walk, so there is
 * nothing to say yes to. And it ends with a raw UUID, which is the single most
 * effective way to make a message look like spam.
 *
 * ── The code is gone from the text, deliberately ───────────────────────────
 *
 * It is still in the link, which is where it belongs — `community-invite.tsx`
 * reads `?code=` and claims it automatically. Printing it again as a fallback
 * cost every invitation a line of machine noise to serve the rare case of a
 * broken link, and a host can always re-send.
 *
 * ── The rules this copy is held to ─────────────────────────────────────────
 *
 * Sentence case, no exclamation marks, no guilt framing, and short. Tested
 * because none of those survive a hurried edit on their own.
 */

export interface InviteMessageInput {
  /** The host, as they would introduce themselves. Null when we have no name. */
  hostName: string | null;
  trailName: string;
  /** The next walk, when there is one to describe. */
  when: string | null;
  where: string | null;
  link: string;
}

/**
 * "Sam", from whatever the profile holds.
 *
 * A first name because this is a message between friends: "Samantha Okafor has
 * invited you" is how a booking system writes, not how a person does.
 */
export function inviteFirstName(fullName: string | null | undefined, username: string | null | undefined): string | null {
  const first = fullName?.trim().split(/\s+/)[0];
  if (first) return first;
  const handle = username?.trim();
  return handle ? `@${handle}` : null;
}

/**
 * The line describing the walk, or null when there is nothing true to say.
 *
 * Both halves are optional and the separator only appears between two real
 * things — a trail with no date and no place produces no line at all rather
 * than a dangling "at".
 */
export function walkLine(when: string | null, where: string | null): string | null {
  const parts: string[] = [];
  if (when?.trim()) parts.push(when.trim());
  if (where?.trim()) parts.push(`at ${where.trim()}`);
  return parts.length ? parts.join(' ') : null;
}

export function buildInviteMessage(input: InviteMessageInput): string {
  const who = input.hostName?.trim();
  const trail = input.trailName.trim() || 'a meetup';

  // Named if we can. "Sam is walking with…" is a person talking; "You have been
  // invited" is a system, and a system is what people ignore.
  const opener = who
    ? `${who} is inviting you to walk together on Pawtchi.`
    : 'You have been invited to walk together on Pawtchi.';

  const detail = walkLine(input.when, input.where);
  const about = detail ? `${trail} — ${detail}.` : `The meetup is ${trail}.`;

  return [
    opener,
    about,
    `Tap to join: ${input.link}`,
    // The promise, said before they tap rather than after. It is also the
    // honest answer to "why is a stranger sending me a link".
    'The link opens Pawtchi if you have it, or the app store if you do not. Nobody is added without the host confirming them.',
  ].join('\n\n');
}

/** What the share sheet titles the message. Short; some apps truncate hard. */
export function inviteShareTitle(hostName: string | null, trailName: string): string {
  const who = hostName?.trim();
  return who ? `${who} invited you to ${trailName.trim()}` : `Join ${trailName.trim()} on Pawtchi`;
}
