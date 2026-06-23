// Curated starter questions for the "Ask Pawtchi" feature.
//
// These reduce blank-page friction and steer owners toward calm, answerable
// questions. Personalised with the pet's name so they read naturally. Pure and
// dependency-free (beyond the shared pronoun helper) so they're unit-testable
// against the locked brand voice — see vetQuestionPrompts.test.ts.

import { possessivePronoun } from './referral';

export interface SuggestedQuestion {
  /** Short label shown on the chip. */
  label: string;
  /** Full question text prefilled into the input when tapped. */
  text: string;
}

/**
 * Build a small set of suggested questions for a given pet. Questions are
 * everyday, answerable, and on-voice (sentence case, no exclamation, calm).
 */
export function getSuggestedQuestions(
  petName?: string | null,
  gender?: string | null,
): SuggestedQuestion[] {
  const name = (petName ?? '').trim() || 'my companion';
  const their = possessivePronoun(gender); // his / her / their

  return [
    { label: 'Healthy weight', text: `Is ${name} at a healthy weight, and how can I help with that gently` },
    { label: 'Food fit', text: `Is ${name}'s current food a good fit for ${their} needs` },
    { label: 'Water intake', text: `Is ${name} drinking enough water for ${their} size` },
    { label: 'Daily activity', text: `How much daily activity suits ${name}` },
    { label: 'Treats', text: `What kind of treats suit ${name}, and how many in a day` },
    { label: 'Itchy skin', text: `${name} has been scratching a little lately, what could be worth looking at` },
  ];
}
