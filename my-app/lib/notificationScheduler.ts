/**
 * notificationScheduler — wraps expo-notifications for activity reminders.
 *
 * Each activity gets one local notification scheduled N minutes before its
 * `scheduled_date + scheduled_time`. The OS-returned identifier is stashed in
 * AsyncStorage keyed on `activity.id` so a later "completed" or "skipped"
 * action can cancel it cleanly — even after an app restart.
 *
 * Quiet hours suppress (silent) rather than shift. A reminder that fires at
 * the wrong time is worse than no reminder at all.
 */

import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY_PREFIX = 'activity_reminder:';

export type NotificationIntensity = 'minimal' | 'standard' | 'chatty';

export interface ScheduledActivity {
  id: string;
  pet_id: string;
  pet_name: string;
  activity_type: string;
  title: string;
  scheduled_date: string; // YYYY-MM-DD
  scheduled_time: string; // HH:MM:SS
}

export interface QuietHours {
  start: string; // HH:MM(:SS)
  end: string;
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function scheduleActivityReminder(
  activity: ScheduledActivity,
  leadMinutes: number,
  quietHours: QuietHours | null,
  intensity: NotificationIntensity = 'standard',
): Promise<string | null> {
  if (!shouldScheduleForType(activity.activity_type, intensity)) return null;

  const fireAt = computeFireTime(activity.scheduled_date, activity.scheduled_time, leadMinutes);
  if (!fireAt) return null;
  if (fireAt.getTime() <= Date.now()) return null; // past

  if (quietHours && fallsInQuietWindow(fireAt, quietHours)) {
    return null; // silent suppression
  }

  const body = renderCopy(activity);
  const identifier = await Notifications.scheduleNotificationAsync({
    content: {
      title: body,
      body: '', // single-sentence design — title carries the whole message
      data: {
        type: 'activity_reminder',
        activityId: activity.id,
        petId: activity.pet_id,
      },
      sound: 'default',
    },
    trigger: { date: fireAt, type: Notifications.SchedulableTriggerInputTypes.DATE },
  });
  await AsyncStorage.setItem(STORAGE_KEY_PREFIX + activity.id, identifier);
  return identifier;
}

export async function cancelActivityReminder(activityId: string): Promise<void> {
  const key = STORAGE_KEY_PREFIX + activityId;
  const identifier = await AsyncStorage.getItem(key);
  if (!identifier) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(identifier);
  } catch (e) {
    // Already fired or removed — non-fatal.
    if (__DEV__) console.log('[notificationScheduler] cancel noop for', activityId, e);
  }
  await AsyncStorage.removeItem(key);
}

/**
 * Bulk cancellation — used by scheduleAdjuster.regenerateSchedule before
 * scheduling the freshly-inserted batch, so we don't leak stale reminders.
 */
export async function cancelAllRemindersForActivities(activityIds: string[]): Promise<void> {
  await Promise.all(activityIds.map(cancelActivityReminder));
}

// ── Helpers ────────────────────────────────────────────────────────────────

function shouldScheduleForType(type: string, intensity: NotificationIntensity): boolean {
  if (intensity === 'minimal') return type === 'feeding' || type === 'medicine';
  if (intensity === 'standard') return type !== 'water';
  return true; // chatty
}

function computeFireTime(date: string, time: string, leadMinutes: number): Date | null {
  // Build a local-time Date from YYYY-MM-DD + HH:MM:SS. Naive parsing — assumes
  // the device timezone matches what the user set up. Acceptable for v1.
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  if (!y || !m || !d) return null;
  const t = new Date(y, m - 1, d, hh || 0, mm || 0, 0);
  t.setMinutes(t.getMinutes() - leadMinutes);
  return t;
}

function fallsInQuietWindow(at: Date, quiet: QuietHours): boolean {
  const minute = at.getHours() * 60 + at.getMinutes();
  const start = parseMin(quiet.start);
  const end = parseMin(quiet.end);
  if (start === end) return false;
  if (start < end) {
    // Window doesn't wrap midnight, e.g. 22:00 → 23:30
    return minute >= start && minute < end;
  }
  // Wraps midnight, e.g. 22:00 → 07:00
  return minute >= start || minute < end;
}

function parseMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function renderCopy(a: ScheduledActivity): string {
  const name = a.pet_name?.trim() || 'your pet';
  switch (a.activity_type) {
    case 'walk':     return `${name}'s walk in 10 minutes.`;
    case 'feeding':  return `${name}'s ${a.title.toLowerCase()} is coming up soon.`;
    case 'training': return `Training time with ${name} shortly.`;
    case 'play':     return `Play session with ${name} coming up.`;
    case 'grooming': return `${name}'s grooming window opens shortly.`;
    case 'medicine': return `${name}'s medication window opens soon.`;
    case 'water':    return `${name}'s water bowl could use a refill.`;
    default:         return `${name}: ${a.title} coming up.`;
  }
}
