/**
 * Notification settings.
 *
 * Until now Pawtchi had no notification controls at all. Quiet hours were
 * written once during onboarding and never honoured by the server, intensity
 * had no UI so no owner had ever changed it, and there was no unsubscribe of
 * any kind — the only way to stop a notification was to switch them off at the
 * OS level, which loses the owner permanently.
 *
 * Everything here is read by notify-dispatch before it sends.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';

import { color, font, radius, space, type } from '../constants/design';
import { PawLoader } from '../components/loader/PawLoader';
import { useNotificationPermission } from '../hooks/useNotificationPermission';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { useAuth } from '../providers/AuthProvider';
import { track } from '../lib/analytics';
import { haptic } from '../lib/haptics';
import {
  CATEGORY_FIELDS,
  DEFAULT_NOTIFICATION_PREFERENCES,
  loadNotificationPreferences,
  saveNotificationPreferences,
  type NotificationIntensity,
  type NotificationPreferences,
} from '../lib/notifications/preferences';

const INTENSITY_OPTIONS: { id: NotificationIntensity; label: string; detail: string }[] = [
  { id: 'minimal', label: 'Minimal', detail: 'Meals and health check-ins only, at most one a week.' },
  { id: 'standard', label: 'Standard', detail: 'Up to one a day, four a week.' },
  { id: 'chatty', label: 'Chatty', detail: 'Up to two a day.' },
];

export default function NotificationSettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const ownerId = session?.user?.id;

  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);
  const permission = useNotificationPermission();
  const { requestPermission } = usePushNotifications();

  const handleTurnOn = async () => {
    try {
      await requestPermission();
    } catch {
      // Denied, or no native module. `refresh` reports whatever actually happened.
    }
    await permission.refresh();
  };

  useEffect(() => {
    track('notification_settings_opened', {});
  }, []);

  useEffect(() => {
    if (!ownerId) return;
    let cancelled = false;
    void (async () => {
      const loaded = await loadNotificationPreferences(ownerId);
      if (!cancelled) {
        setPrefs(loaded);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ownerId]);

  // Persist on every change. The screen has no save button by design — a
  // settings screen that can be left in an unsaved state is a settings screen
  // people abandon halfway through.
  const update = useCallback(
    (patch: Partial<NotificationPreferences>, changedKey: string) => {
      if (!ownerId) return;
      const next = { ...prefs, ...patch };
      setPrefs(next);
      haptic.select();
      track('notification_settings_changed', {
        setting: changedKey,
        value: String(Object.values(patch)[0]),
      });
      void saveNotificationPreferences(ownerId, next);
    },
    [ownerId, prefs],
  );

  if (loading) {
    return (
      <View style={[styles.screen, styles.centred]}>
        <PawLoader visible message="Opening your settings" />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button">
          <MaterialIcons name="arrow-back" size={22} color={color.ink} />
        </Pressable>
        <Text style={styles.headerTitle}>Notifications</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxxl }}
        showsVerticalScrollIndicator={false}
      >
        {/* The OS has the final say. Before this, an owner who had denied at
            the system level still saw "Allow notifications: ON" with every
            category enabled, and could toggle happily while receiving nothing.
            The in-app switches are meaningless until the OS permission is
            granted, so say that plainly and offer the only route that works. */}
        {permission.status !== 'loading' && !permission.isGranted && (
          <View style={[styles.card, styles.blockedCard]}>
            <View style={styles.blockedHeader}>
              <MaterialIcons name="notifications-off" size={18} color={color.alertDeep} />
              <Text style={styles.blockedTitle}>Notifications are off</Text>
            </View>
            <Text style={styles.blockedBody}>
              {permission.isBlocked
                ? 'Pawtchi cannot turn these back on for you. Open your device settings and allow notifications for Pawtchi, then come back.'
                : 'Nothing below takes effect until notifications are allowed on this device.'}
            </Text>
            <Pressable
              style={styles.blockedBtn}
              onPress={permission.isBlocked ? permission.openSystemSettings : handleTurnOn}
              accessibilityRole="button"
            >
              <Text style={styles.blockedBtnText}>
                {permission.isBlocked ? 'Open device settings' : 'Turn on notifications'}
              </Text>
            </Pressable>
          </View>
        )}

        <View style={[styles.card, !permission.isGranted && styles.cardMuted]}>
          <Row
            label="Allow notifications"
            detail="Turning this off stops every push from Pawtchi."
            value={prefs.push_enabled}
            onChange={(v) => update({ push_enabled: v }, 'push_enabled')}
          />
        </View>

        {prefs.push_enabled && (
          <>
            <Text style={styles.sectionLabel}>How often</Text>
            <View style={styles.card}>
              {INTENSITY_OPTIONS.map((opt, i) => {
                const active = prefs.notification_intensity === opt.id;
                return (
                  <Pressable
                    key={opt.id}
                    onPress={() => update({ notification_intensity: opt.id }, 'intensity')}
                    style={[styles.optionRow, i > 0 && styles.divider]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                  >
                    <View style={styles.optionText}>
                      <Text style={styles.rowLabel}>{opt.label}</Text>
                      <Text style={styles.rowDetail}>{opt.detail}</Text>
                    </View>
                    <MaterialIcons
                      name={active ? 'radio-button-checked' : 'radio-button-unchecked'}
                      size={20}
                      color={active ? color.navy : color.slateFaint}
                    />
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.sectionLabel}>Quiet hours</Text>
            <View style={styles.card}>
              <Text style={styles.cardIntro}>
                Nothing is sent during these hours. Milestones wait until they pass rather than
                being dropped.
              </Text>
              <View style={styles.timeRow}>
                <TimeChip label="From" value={prefs.quiet_hours_start} onPress={() => setPicking('start')} />
                <TimeChip label="Until" value={prefs.quiet_hours_end} onPress={() => setPicking('end')} />
              </View>
            </View>

            <Text style={styles.sectionLabel}>What to send</Text>
            <View style={styles.card}>
              {CATEGORY_FIELDS.map((field, i) => (
                <View key={field.key} style={i > 0 ? styles.divider : undefined}>
                  <Row
                    label={field.label}
                    detail={field.detail}
                    value={prefs[field.key]}
                    onChange={(v) => update({ [field.key]: v } as Partial<NotificationPreferences>, field.key)}
                  />
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      {picking && (
        <DateTimePicker
          value={timeToDate(picking === 'start' ? prefs.quiet_hours_start : prefs.quiet_hours_end)}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(event, date) => {
            if (Platform.OS !== 'ios') setPicking(null);
            if (event.type === 'dismissed' || !date) return;
            const value = dateToTime(date);
            update(
              picking === 'start' ? { quiet_hours_start: value } : { quiet_hours_end: value },
              picking === 'start' ? 'quiet_hours_start' : 'quiet_hours_end',
            );
            if (Platform.OS === 'ios') setPicking(null);
          }}
        />
      )}
    </View>
  );
}

function Row({
  label,
  detail,
  value,
  onChange,
}: {
  label: string;
  detail: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <View style={styles.switchRow}>
      <View style={styles.optionText}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowDetail}>{detail}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: color.track, true: color.navy }}
        thumbColor={color.surface}
      />
    </View>
  );
}

function TimeChip({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <Pressable style={styles.timeChip} onPress={onPress} accessibilityRole="button">
      <Text style={styles.timeChipLabel}>{label}</Text>
      <Text style={styles.timeChipValue}>{value}</Text>
    </Pressable>
  );
}

function timeToDate(time: string): Date {
  const [h, m] = time.split(':').map(Number);
  const d = new Date();
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

function dateToTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.surfaceSubtle },
  centred: { alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  headerTitle: { ...type.heading, color: color.ink },
  sectionLabel: {
    ...type.label,
    color: color.slate,
    marginTop: space.lg,
    marginBottom: space.sm,
  },
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.hairline,
    paddingHorizontal: space.lg,
  },
  cardMuted: { opacity: 0.55 },
  blockedCard: {
    backgroundColor: color.alertSoft,
    borderColor: color.alert,
    paddingVertical: space.lg,
    marginBottom: space.md,
  },
  blockedHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  blockedTitle: { ...type.bodyMedium, color: color.alertDeep },
  blockedBody: {
    ...type.body,
    fontSize: 13,
    lineHeight: 18,
    color: color.alertDeep,
    marginTop: space.xs,
  },
  blockedBtn: {
    marginTop: space.md,
    backgroundColor: color.navy,
    borderRadius: radius.pill,
    paddingVertical: space.sm + 2,
    alignItems: 'center',
  },
  blockedBtnText: { fontFamily: font.semibold, fontSize: 14, color: color.cream },
  cardIntro: {
    ...type.body,
    color: color.slateMuted,
    paddingTop: space.lg,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.lg,
    gap: space.md,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.lg,
    gap: space.md,
  },
  optionText: { flex: 1 },
  rowLabel: { ...type.bodyMedium, color: color.ink },
  rowDetail: { ...type.body, fontSize: 13, lineHeight: 18, color: color.slateMuted, marginTop: 2 },
  divider: { borderTopWidth: 1, borderTopColor: color.hairline },
  timeRow: { flexDirection: 'row', gap: space.md, paddingVertical: space.lg },
  timeChip: {
    flex: 1,
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
  },
  timeChipLabel: { ...type.caption, color: color.slateMuted },
  timeChipValue: { fontFamily: font.semibold, fontSize: 17, color: color.ink, marginTop: 2 },
});
