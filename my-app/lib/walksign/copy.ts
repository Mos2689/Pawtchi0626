/**
 * Walksign copy — every user-facing Walksign string lives here, nowhere else.
 *
 * All strings comply with the Pawtchi Copy Spec v1 (same rules as
 * lib/referral.ts): no exclamation marks, never "your pet", the pet's name
 * and correct pronoun where known, calm sentence case, three sentences max.
 * walksignCopy.test.ts enforces the voice so edits can't drift.
 *
 * The names themselves are working titles pending trademark screening —
 * renaming a sign is an edit to this file only.
 */

import { PAWTCHI_INVITE_URL, possessivePronoun } from '../referral';
import type { WalksignId, WalksignStatus, WalksignTransitionKind } from './types';

interface WalksignCopy {
  /** The wearable identity: "Wonderbound". */
  displayName: string;
  /** One line under the name — the sign's campaign thought. */
  tagline: string;
  /** The fuller manifesto shown in the detail modal. */
  manifesto: string;
}

export const WALKSIGN_COPY: Record<WalksignId, WalksignCopy> = {
  newbond: {
    displayName: 'Newbond',
    tagline: 'The dog who made you a dog person.',
    manifesto:
      'Newbonds are the dogs who teach someone how deep this relationship can become. The first year writes the whole chapter.',
  },
  loopkeeper: {
    displayName: 'Loopkeeper',
    tagline: 'Same route. Never the same walk.',
    manifesto:
      'Loopkeepers know that familiar paths are not boring. They are how a neighbourhood becomes home.',
  },
  blockscout: {
    displayName: 'Blockscout',
    tagline: 'Every corner is worth knowing.',
    manifesto:
      'Blockscouts know every doorway, tree, shortcut, and dog three streets over. The route is only half the story.',
  },
  packheart: {
    displayName: 'Packheart',
    tagline: 'Many hands. One best friend.',
    manifesto:
      'Packhearts belong to everyone, and somehow make everyone belong to each other.',
  },
  softstep: {
    displayName: 'Softstep',
    tagline: 'Space is part of the walk.',
    manifesto:
      "Softsteps notice more, need more space, and choose their moments carefully. Good walks happen at the dog's pace.",
  },
  storywalker: {
    displayName: 'Storywalker',
    tagline: 'Some paths become part of us.',
    manifesto:
      'Storywalkers carry years of familiar paths with them. The distance matters less than everything that happened along the way.',
  },
  wonderbound: {
    displayName: 'Wonderbound',
    tagline: 'The whole world is new.',
    manifesto:
      'Wonderbound dogs are going somewhere new, even when they only reach the end of the street.',
  },
};

function cleanName(name?: string | null): string | null {
  const trimmed = (name ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** "Ziggy's first Walksign" — the reveal beat's title. */
export function buildRevealTitle(petName?: string | null): string {
  const name = cleanName(petName);
  return name ? `${name}'s first Walksign` : 'A first Walksign';
}

/** Honest provisional framing under the revealed sign. */
export function buildProvisionalNote(petName?: string | null): string {
  const name = cleanName(petName);
  return name
    ? `A first reading. ${name}'s walks will tell the rest.`
    : 'A first reading. The walks will tell the rest.';
}

/** Profile status line: where the sign currently stands. */
export function buildStatusLine(
  status: WalksignStatus,
  confirmedWalkCount?: number | null,
): string {
  if (status === 'confirmed') {
    return confirmedWalkCount && confirmedWalkCount > 0
      ? `Confirmed by ${confirmedWalkCount} walks`
      : 'Confirmed by walks';
  }
  return 'Provisional · a first reading';
}

/** The confirmation moment's headline: earned, in their own steps. */
export function buildConfirmationHeadline(
  petName?: string | null,
  gender?: string | null,
): string {
  const name = cleanName(petName);
  const possessive = possessivePronoun(gender);
  return name
    ? `Written in ${possessive} walks. Confirmed.`
    : 'Written in the walks. Confirmed.';
}

/** Body under the confirmation headline. */
export function buildConfirmationBody(
  sign: WalksignId,
  petName?: string | null,
  validWalkCount = 5,
): string {
  const name = cleanName(petName);
  const display = WALKSIGN_COPY[sign].displayName;
  const count = Math.max(5, Math.floor(validWalkCount));
  return name
    ? `${count} real walks agree. ${name} is a ${display}.`
    : `${count} real walks agree on it. A ${display}.`;
}

/** Transition headline — the celebrated life-moment reassignments. */
export function buildTransitionHeadline(
  kind: WalksignTransitionKind,
  newSign: WalksignId,
  petName?: string | null,
): string {
  const name = cleanName(petName) ?? 'This dog';
  const display = WALKSIGN_COPY[newSign].displayName;
  if (kind === 'wonderbound_graduation') {
    return `Wonderbound, graduated. ${name} walks as a ${display} now.`;
  }
  if (kind === 'storywalker_arrival') {
    return `${name} has walked enough paths to carry them. Storywalker.`;
  }
  return `${name}'s walks have found a new rhythm. ${display}.`;
}

/** Share text for the identity itself (modal + profile share actions). */
export function buildWalksignShareMessage(
  sign: WalksignId,
  petName?: string | null,
  gender?: string | null,
): string {
  const name = cleanName(petName);
  const display = WALKSIGN_COPY[sign].displayName;
  const possessive = possessivePronoun(gender);
  return name
    ? `${name} is a ${display}. A Pawtchi Walksign, written in ${possessive} walks. ${PAWTCHI_INVITE_URL}`
    : `Every dog has a Walksign, written in their walks. ${PAWTCHI_INVITE_URL}`;
}

/** The Paw Moment card lockup: "WONDERBOUND" over "A Pawtchi Walksign". */
export function buildWalksignLockup(sign: WalksignId): {
  title: string;
  caption: string;
} {
  return {
    title: WALKSIGN_COPY[sign].displayName.toUpperCase(),
    caption: 'A Pawtchi Walksign',
  };
}
