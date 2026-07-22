// ── Password-recovery routing latch ──
// verifyOtp({ type: 'recovery' }) creates a live session as a side effect of
// checking the code — BEFORE the user has actually set a new password. The
// centralized auth gate in app/_layout.tsx reacts to `session && inPublic` and
// would immediately route into the app, tearing down the reset screen mid-flow.
// This latch tells the gate to hold still while a recovery is in flight; the
// reset screen navigates explicitly the moment the new password is committed.
//
// Mirrors the freshSignup latch in onboardingFunnel.ts, but PEEKS (never
// consumes) — the gate re-reads it on every render, so it must stay true for
// the whole verifyOtp → updateUser window and is cleared by the flow itself.
// Deliberately in-memory: an app restart mid-reset simply lands the user on the
// normal fetch-then-redirect path, which is the correct fallback.
let recoveryInProgress = false;

export function markRecoveryInProgress(): void {
  recoveryInProgress = true;
}

export function clearRecoveryInProgress(): void {
  recoveryInProgress = false;
}

/** Non-destructive read — the gate checks this on every render. */
export function isRecoveryInProgress(): boolean {
  return recoveryInProgress;
}
