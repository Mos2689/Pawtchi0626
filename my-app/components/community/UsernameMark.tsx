/**
 * The glyph at the right edge of a username field.
 *
 * Shared by all three places the field appears, because a check that means
 * "free" on one screen and "saved" on another is worse than no check at all.
 *
 * ── What is deliberately blank ──────────────────────────────────────────────
 *
 * Only four states draw anything. `idle` has nothing to report. `invalid` is
 * already explained by the line under the field, and a red cross next to
 * somebody who has typed two of their three characters is telling them off for
 * not having finished. `unknown` stays blank too: a warning triangle for "our
 * check did not reach the server" reads as "your name is wrong", which is a
 * different and untrue statement — the text under the field says what actually
 * happened.
 *
 * The paw breathes while a check is in flight. ActivityIndicator is banned
 * app-wide; the living-paw motion language is the loader everywhere.
 */

import React from 'react';
import { Ionicons } from '@expo/vector-icons';

import { color } from '../../constants/design';
import { BreathingPaw } from '../BreathingPaw';
import type { UsernameStatus } from '../../lib/community/usernameStatus';

export function UsernameMark({ status }: { status: UsernameStatus }) {
  if (status === 'checking') {
    return <BreathingPaw size={18} workingColor={color.slateFaint} />;
  }
  // `unchanged` gets the same tick as `available`: to the person holding it,
  // "this one is mine" and "this one is free" look identical and both mean yes.
  if (status === 'available' || status === 'unchanged') {
    return <Ionicons name="checkmark-circle" size={20} color={color.success} />;
  }
  if (status === 'taken') {
    return <Ionicons name="close-circle" size={20} color={color.error} />;
  }
  return null;
}
