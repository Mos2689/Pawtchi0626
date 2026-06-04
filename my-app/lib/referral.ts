// Referral / "Invite a friend" copy helpers.
//
// All strings here must comply with the Pawtchi Copy Spec v1 (the locked brand book):
//   - No exclamation marks, anywhere.
//   - Use the pet's name; never "your pet".
//   - Correct possessive pronoun from the pet's sex (his / her); only fall back to
//     "their" when the sex is unknown — never for a known animal.
//   - Sentence case, calm and plainspoken, three sentences max, ends with an action.
//   - No hype, no emoji, none of the banned words.
//
// The accompanying referral.test.ts enforces these rules so future copy edits can't
// quietly violate the brand voice.

export const PAWTCHI_INVITE_URL = 'https://pawtchi.com';

export interface InvitePet {
  name?: string | null;
  gender?: 'male' | 'female' | string | null;
}

/** Possessive pronoun for a known animal: his / her. Falls back to "their" if sex is unknown. */
export function possessivePronoun(gender?: string | null): string {
  if (gender === 'male') return 'his';
  if (gender === 'female') return 'her';
  return 'their';
}

function cleanName(name?: string | null): string | null {
  const trimmed = (name ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Screen headline, e.g. "A friend for Bruno". Name-free fallback when the name is missing. */
export function buildInviteHeadline(petName?: string | null): string {
  const name = cleanName(petName);
  return name ? `A friend for ${name}` : 'A friend for your companion';
}

/** Calm sub-copy that carries the emotional weight without hype. */
export function buildInviteSubcopy(petName?: string | null): string {
  const name = cleanName(petName);
  const tail = name
    ? `the way you look after ${name}.`
    : 'the way you look after yours.';
  return `Pawtchi is better shared. Invite someone who looks after their animal ${tail}`;
}

/**
 * The message body, without the link. Used on iOS where the URL is passed as a
 * separate `url` item so the share sheet renders a rich link preview (driven by
 * the Open Graph tags on pawtchi.com) instead of a bare URL inside the text.
 */
export function buildInviteBody(pet?: InvitePet): string {
  const name = cleanName(pet?.name);
  if (name) {
    const pronoun = possessivePronoun(pet?.gender);
    return `I've been using Pawtchi to look after ${name} — ${pronoun} meals, activity and weight, all in one place. Thought you might like it for yours.`;
  }
  return `I've been using Pawtchi to look after my pet — meals, activity and weight, all in one place. Thought you might like it for yours.`;
}

/** Full text the native share sheet sends — body plus the link. Used where the URL
 *  must live inside the text (e.g. Android, which ignores Share's `url` field). */
export function buildInviteMessage(pet?: InvitePet): string {
  return `${buildInviteBody(pet)} ${PAWTCHI_INVITE_URL}`;
}
