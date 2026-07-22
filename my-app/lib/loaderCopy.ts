// ─────────────────────────────────────────────────────────────────────────────
// Context copy for the Living Paw loader — short, purposeful lines that make
// the wait feel like Pawtchi quietly working on the pet's behalf.
//
// Voice rules (brand copy spec): calm, warm, specific. Sentence case, no
// exclamation marks. NEVER "Loading…", "Please wait…" or "Fetching data…".
// The loader appends the trailing ellipsis — don't include one here.
//
// aiVet copy is intentionally absent: ask.tsx builds personalised lines with
// the pet's name/pronouns and passes them via the `lines` prop.
// ─────────────────────────────────────────────────────────────────────────────

export const loaderCopy = {
  launch: [
    'Gathering the day’s moments',
    'Picking up where you left off',
    'Almost with you',
  ],
  scan: [
    'Reading the label',
    'Checking the ingredients',
    'Weighing the nutrition',
    'Forming a verdict',
  ],
  report: [
    'Collecting the story so far',
    'Organising the health signals',
    'Preparing the vet report',
  ],
  sync: [
    'Catching up on today',
    'Connecting recent activity',
  ],
  generic: [
    'Connecting the moments',
    'Making sense of things',
    'Almost there',
  ],
} as const;

export type LoaderCopyKey = keyof typeof loaderCopy;
