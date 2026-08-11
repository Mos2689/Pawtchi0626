/**
 * Notification preferences — load and save the owner's push settings.
 *
 * These columns already existed (quiet_hours_start/end, nudge_lead_minutes,
 * notification_intensity, added 20260624000000) but nothing in the app could
 * edit them and nothing on the server read them. In production that meant 42
 * owners had quiet hours of 22:00-07:00 saved from the onboarding defaults,
 * every one of them untouched, while the dispatcher pushed at whatever hour
 * its (wrong) server clock said. No owner had ever changed intensity, because
 * there was no control to change it with.
 *
 * The category flags and push_enabled are new (20260805000000).
 */

import { supabase } from '../supabase';

export type NotificationIntensity = 'minimal' | 'standard' | 'chatty';

export interface NotificationPreferences {
  push_enabled: boolean;
  quiet_hours_start: string; // 'HH:MM'
  quiet_hours_end: string;
  nudge_lead_minutes: number;
  notification_intensity: NotificationIntensity;
  cat_care_reminders: boolean;
  cat_health_insights: boolean;
  cat_milestones: boolean;
  cat_digest: boolean;
  cat_lifecycle: boolean;
  cat_walk: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  push_enabled: true,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  nudge_lead_minutes: 10,
  notification_intensity: 'standard',
  cat_care_reminders: true,
  cat_health_insights: true,
  cat_milestones: true,
  cat_digest: true,
  cat_lifecycle: true,
  cat_walk: true,
};

export const CATEGORY_FIELDS = [
  {
    key: 'cat_care_reminders' as const,
    label: 'Meal and care reminders',
    detail: 'A nudge before a feeding window, and when a weigh-in is due.',
  },
  {
    key: 'cat_health_insights' as const,
    label: 'Health signals',
    detail: 'Only when something in the plan needs a look, such as eating well under target.',
  },
  {
    key: 'cat_milestones' as const,
    label: 'Milestones',
    detail: 'Weight stages reached, and a confirmed Walksign.',
  },
  {
    key: 'cat_digest' as const,
    label: 'Weekly recap',
    detail: 'One summary on Sunday evening, and only when there is something to report.',
  },
  {
    key: 'cat_lifecycle' as const,
    label: 'Getting started and check-ins',
    detail: 'Setup prompts, and the occasional note if things have gone quiet.',
  },
  {
    key: 'cat_walk' as const,
    label: 'Walks',
    detail: 'What we noticed on a walk, sent after it ends. Never a reminder to go.',
  },
];

function stripSeconds(t: string | null | undefined, fallback: string): string {
  if (!t) return fallback;
  return t.length >= 5 ? t.slice(0, 5) : t;
}

export async function loadNotificationPreferences(
  ownerId: string,
): Promise<NotificationPreferences> {
  const { data, error } = await supabase
    .from('owner_preferences')
    .select(
      'push_enabled, quiet_hours_start, quiet_hours_end, nudge_lead_minutes, notification_intensity, cat_care_reminders, cat_health_insights, cat_milestones, cat_digest, cat_lifecycle, cat_walk',
    )
    .eq('owner_id', ownerId)
    .maybeSingle();

  // 116 of 158 onboarded owners have no preferences row at all, so a missing
  // row is the normal case, not an error.
  if (error || !data) return { ...DEFAULT_NOTIFICATION_PREFERENCES };

  const row = data as Partial<NotificationPreferences>;
  const d = DEFAULT_NOTIFICATION_PREFERENCES;
  return {
    push_enabled: row.push_enabled ?? d.push_enabled,
    quiet_hours_start: stripSeconds(row.quiet_hours_start, d.quiet_hours_start),
    quiet_hours_end: stripSeconds(row.quiet_hours_end, d.quiet_hours_end),
    nudge_lead_minutes: row.nudge_lead_minutes ?? d.nudge_lead_minutes,
    notification_intensity: row.notification_intensity ?? d.notification_intensity,
    cat_care_reminders: row.cat_care_reminders ?? d.cat_care_reminders,
    cat_health_insights: row.cat_health_insights ?? d.cat_health_insights,
    cat_milestones: row.cat_milestones ?? d.cat_milestones,
    cat_digest: row.cat_digest ?? d.cat_digest,
    cat_lifecycle: row.cat_lifecycle ?? d.cat_lifecycle,
    cat_walk: row.cat_walk ?? d.cat_walk,
  };
}

/**
 * Upserts only the notification columns, so it cannot clobber the routine
 * anchors RoutineSheet owns on the same row.
 */
export async function saveNotificationPreferences(
  ownerId: string,
  prefs: NotificationPreferences,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('owner_preferences')
    .upsert(
      { owner_id: ownerId, ...prefs },
      { onConflict: 'owner_id' },
    );
  return { error: error?.message ?? null };
}
