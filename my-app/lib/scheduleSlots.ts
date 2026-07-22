/**
 * scheduleSlots.ts — owner-aware daily slot solver.
 *
 * Takes the owner's routine prefs + species + weekend flag and returns the
 * clock times for each slot in a day's pet-care timeline. Pure function,
 * deterministic, no I/O. Consumed by the generate-schedule edge function to
 * replace the previous hardcoded slot times.
 *
 * Falls back to sensible species-aware defaults whenever any field is null,
 * so a partially-filled prefs row still produces a coherent day.
 */

export type Species = 'dog' | 'cat';

export interface OwnerPrefs {
  wake_time: string | null;          // 'HH:MM' or 'HH:MM:SS'
  bedtime: string | null;
  work_start: string | null;         // null when home during the day
  work_end: string | null;
  weekend_shifts_hours: number | null;
  // walk windows are advisory — used by the AI archetype pool, not the solver
}

export interface DaySlots {
  breakfast: string;       // HH:MM:SS
  morningActivity: string;
  middayHydration: string;
  lunch: string | null;    // null = skip (dogs eat 2x by default)
  middayActivity: string;
  eveningHydration: string;
  dinner: string;
  eveningActivity: string;
  windDown: string;
}

const DEFAULT_WAKE_DOG = '07:00';
const DEFAULT_WAKE_CAT = '06:30';
const DEFAULT_BEDTIME = '22:30';

// ── Time helpers ──────────────────────────────────────────────────────────

function parseTime(t: string | null, fallback: string): number {
  const src = t ?? fallback;
  const [h, m] = src.split(':').map(Number);
  return h * 60 + (m || 0);
}

function formatTime(minutesSinceMidnight: number): string {
  // Wrap on day boundary so a bedtime of 25:00 becomes 01:00 cleanly.
  const wrapped = ((minutesSinceMidnight % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Resolve the day's clock anchors from owner prefs.
 *
 * Anchoring rules (all derived from wake / bedtime / work / weekend shift):
 *   - breakfast       = wake + 30
 *   - morningActivity = work_start − 75   (or wake + 45 if no work)
 *   - middayHydration = midpoint(work_start, work_end)   (or noon)
 *   - lunch           = midday − 15       (cats only by default)
 *   - middayActivity  = midday + 30
 *   - eveningHydration= work_end + 15     (or 17:00)
 *   - dinner          = work_end + 60     (or 18:30)
 *   - eveningActivity = dinner + 75       (digestion buffer for bloat risk)
 *   - windDown        = bedtime − 60
 *
 * `weekend_shifts_hours` is applied uniformly across every slot above when
 * `isWeekend` is true.
 */
export function resolveSlots(
  prefs: OwnerPrefs | null,
  isWeekend: boolean,
  species: Species,
): DaySlots {
  const defaultWake = species === 'cat' ? DEFAULT_WAKE_CAT : DEFAULT_WAKE_DOG;
  const wake = parseTime(prefs?.wake_time ?? null, defaultWake);
  const bedtime = parseTime(prefs?.bedtime ?? null, DEFAULT_BEDTIME);

  const workStart = prefs?.work_start ? parseTime(prefs.work_start, '09:00') : null;
  const workEnd = prefs?.work_end ? parseTime(prefs.work_end, '17:30') : null;

  // Weekend shift in minutes. Clamp to ±4h so a malformed value can't push
  // breakfast into the middle of the night.
  const shiftHours = Math.max(-2, Math.min(4, prefs?.weekend_shifts_hours ?? 0));
  const shift = isWeekend ? shiftHours * 60 : 0;

  const breakfast = wake + 30;
  const morningActivity = workStart !== null ? workStart - 75 : wake + 45;
  const midday = workStart !== null && workEnd !== null
    ? Math.round((workStart + workEnd) / 2)
    : 12 * 60;
  const middayActivity = midday + 30;
  const eveningHydrationBase = workEnd !== null ? workEnd + 15 : 17 * 60;
  const dinner = workEnd !== null ? workEnd + 60 : 18 * 60 + 30;
  const eveningActivity = dinner + 75;
  const windDown = bedtime - 60;

  // Lunch slot: cats eat ad-lib, so we surface a lunch feeding card for them
  // by default. Dogs eat 2x — only render the lunch slot if the owner is home
  // (no work window) AND wants a midday meal, which we defer to the prefs UI
  // later. For now: dogs = null, cats = midday − 15.
  const lunch = species === 'cat' ? midday - 15 : null;

  return {
    breakfast: formatTime(breakfast + shift),
    morningActivity: formatTime(morningActivity + shift),
    middayHydration: formatTime(midday + shift),
    lunch: lunch !== null ? formatTime(lunch + shift) : null,
    middayActivity: formatTime(middayActivity + shift),
    eveningHydration: formatTime(eveningHydrationBase + shift),
    dinner: formatTime(dinner + shift),
    eveningActivity: formatTime(eveningActivity + shift),
    windDown: formatTime(windDown + shift),
  };
}
