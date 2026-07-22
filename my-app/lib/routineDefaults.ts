/**
 * routineDefaults — species-aware default values for the routine bottom sheet.
 *
 * Used to pre-fill RoutineSheet so first-time users see a confirmation, not a
 * blank form. The defaults match what the slot solver falls back to when fields
 * are null, so tapping "Build Buddy's plan" without changing anything produces
 * the same plan as if no prefs existed at all (no surprise).
 */

import type { OwnerPrefs } from './scheduleSlots';

export type Species = 'dog' | 'cat';
export type WalkWindow = 'morning' | 'lunch' | 'evening' | 'night';

export interface RoutineFormState {
  wake_time: string;     // 'HH:MM'
  bedtime: string;
  has_work_window: boolean;
  work_start: string;
  work_end: string;
  walk_windows: WalkWindow[];
  weekend_shifts_hours: number;
  weekend_different: boolean;
  nudge_lead_minutes: number;
  quiet_hours_start: string;
  quiet_hours_end: string;
  notification_intensity: 'minimal' | 'standard' | 'chatty';
}

export function defaultRoutine(species: Species): RoutineFormState {
  return {
    wake_time: species === 'cat' ? '06:30' : '07:00',
    bedtime: '22:30',
    has_work_window: false,
    work_start: '09:00',
    work_end: '17:30',
    walk_windows: ['morning', 'evening'],
    weekend_shifts_hours: 0,
    weekend_different: false,
    nudge_lead_minutes: 10,
    quiet_hours_start: '22:00',
    quiet_hours_end: '07:00',
    notification_intensity: 'standard',
  };
}

/**
 * Convert form state → DB row. Honors `has_work_window` / `weekend_different`
 * so the persisted row stays minimal (null instead of carrying defaults that
 * the user never confirmed).
 */
export function routineToRow(form: RoutineFormState): OwnerPrefsRow {
  return {
    wake_time: form.wake_time,
    bedtime: form.bedtime,
    work_start: form.has_work_window ? form.work_start : null,
    work_end: form.has_work_window ? form.work_end : null,
    walk_window_morning_start: form.walk_windows.includes('morning') ? '07:00' : null,
    walk_window_morning_end: form.walk_windows.includes('morning') ? '09:00' : null,
    walk_window_evening_start: form.walk_windows.includes('evening') ? '17:30' : null,
    walk_window_evening_end: form.walk_windows.includes('evening') ? '20:00' : null,
    weekend_shifts_hours: form.weekend_different ? form.weekend_shifts_hours : 0,
    nudge_lead_minutes: form.nudge_lead_minutes,
    quiet_hours_start: form.quiet_hours_start,
    quiet_hours_end: form.quiet_hours_end,
    notification_intensity: form.notification_intensity,
  };
}

export function rowToForm(row: OwnerPrefsRow | null, species: Species): RoutineFormState {
  if (!row) return defaultRoutine(species);
  const fallback = defaultRoutine(species);
  return {
    wake_time: stripSeconds(row.wake_time) ?? fallback.wake_time,
    bedtime: stripSeconds(row.bedtime) ?? fallback.bedtime,
    has_work_window: !!(row.work_start && row.work_end),
    work_start: stripSeconds(row.work_start) ?? fallback.work_start,
    work_end: stripSeconds(row.work_end) ?? fallback.work_end,
    walk_windows: [
      ...(row.walk_window_morning_start ? (['morning'] as WalkWindow[]) : []),
      ...(row.walk_window_evening_start ? (['evening'] as WalkWindow[]) : []),
    ],
    weekend_shifts_hours: row.weekend_shifts_hours ?? 0,
    weekend_different: (row.weekend_shifts_hours ?? 0) !== 0,
    nudge_lead_minutes: row.nudge_lead_minutes ?? fallback.nudge_lead_minutes,
    quiet_hours_start: stripSeconds(row.quiet_hours_start) ?? fallback.quiet_hours_start,
    quiet_hours_end: stripSeconds(row.quiet_hours_end) ?? fallback.quiet_hours_end,
    notification_intensity: row.notification_intensity ?? fallback.notification_intensity,
  };
}

function stripSeconds(t: string | null | undefined): string | null {
  if (!t) return null;
  return t.length >= 5 ? t.slice(0, 5) : t;
}

// DB-shape row — superset of OwnerPrefs (which only carries what the slot
// solver reads). Walk windows + notification fields live on the row but the
// solver ignores them.
export interface OwnerPrefsRow extends OwnerPrefs {
  walk_window_morning_start: string | null;
  walk_window_morning_end: string | null;
  walk_window_evening_start: string | null;
  walk_window_evening_end: string | null;
  nudge_lead_minutes: number | null;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  notification_intensity: 'minimal' | 'standard' | 'chatty' | null;
}
