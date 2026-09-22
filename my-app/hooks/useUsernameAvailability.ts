/**
 * Checks a username as it is typed, without turning the field into a strobe.
 *
 * ── The three things that go wrong without care ─────────────────────────────
 *
 * 1. **A request per keystroke.** Typing "bella_and_sam" is thirteen round
 *    trips to learn one answer. Debounced: the check fires once the person
 *    stops for a beat, which is also when they are actually looking at it.
 *
 * 2. **Answers arriving out of order.** The check for "bell" can land after
 *    the check for "bella" — slower network, earlier request — and repaint the
 *    field with a stale verdict. Every reply is matched against the value that
 *    is in the box right now, and dropped if it no longer applies.
 *
 * 3. **Answering about a value that is gone.** Blur, unmount, or three more
 *    characters all mean the question changed. The `live` flag is the mount
 *    guard; the value comparison is the rest.
 *
 * The status this returns is never a gate on its own — see blocksSave() in
 * lib/community/usernameStatus.ts for what is allowed to stop a save.
 */

import { useEffect, useRef, useState } from 'react';

import { isUsernameAvailable } from '../lib/communityWalks';
import {
  localStatus, statusFromAnswer, type UsernameStatus,
} from '../lib/community/usernameStatus';

/**
 * Long enough that a steady typist is not chased, short enough that the answer
 * feels like it belongs to the thing they just typed rather than to a later
 * thought. Also the window in which most typos get corrected, so most bad
 * values never reach the network at all.
 */
const DEBOUNCE_MS = 450;

export function useUsernameAvailability(
  value: string,
  current?: string | null,
): UsernameStatus {
  // Seeded from the synchronous answer so the very first paint is already
  // right — an empty field must not flash "checking" before settling on idle.
  const [status, setStatus] = useState<UsernameStatus>(() => localStatus(value, current));
  const live = useRef(true);

  // Re-pointed every render, so a reply that is still in flight can be checked
  // against what is in the box NOW rather than against the closure it was born
  // in. Clearing the debounce timer only cancels checks that have not left yet.
  const latest = useRef(value);
  latest.current = value;

  // Set on mount as well as cleared on unmount: under StrictMode the effect
  // mounts, unmounts and mounts again, and a flag that is only ever cleared
  // would leave the hook permanently mute in development.
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  useEffect(() => {
    const local = localStatus(value, current);
    // idle / invalid / unchanged are decided here and need no network. Setting
    // them immediately is what makes deleting a character feel instant.
    if (local !== 'checking') {
      setStatus(local);
      return;
    }

    setStatus('checking');
    const timer = setTimeout(() => {
      // The question, captured so the reply can be matched to it. A slow check
      // for "bell" must not repaint a field that now reads "bella".
      const asked = value;
      void isUsernameAvailable(asked).then(answer => {
        if (!live.current || latest.current !== asked) return;
        setStatus(statusFromAnswer(answer));
      });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [value, current]);

  return status;
}
