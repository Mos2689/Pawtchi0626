/**
 * The notification center.
 *
 * Everything the app has to say now arrives here — the nudge engine's output,
 * the clinical banners that used to stack above Home's map, the profile
 * completion card that opened the Health tab, and the pushes already sent.
 *
 * Two sections, and the split is the point:
 *
 *   Needs attention — clinical and action items. Something is undecided.
 *   Earlier         — information and celebration. Nothing is owed.
 *
 * Named `/inbox` rather than `/notifications` because that route is already the
 * notification *settings* screen. The gear in this header is how you reach it,
 * which is also where people look for it.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import Reanimated from 'react-native-reanimated';

import { color, font, makeShadow, radius, space, type } from '../constants/design';
import { entrance } from '../components/motionPresets';
import { haptic } from '../lib/haptics';
import { track } from '../lib/analytics';
import { supabase } from '../lib/supabase';
import { armWalkStart } from '../lib/walk/walkStartIntent';
import { useActivePetStore } from '../store/useActivePetStore';
import { usePetContextStore } from '../store/usePetContextStore';
import { useSubscription } from '../hooks/useSubscription';
import { useAuth } from '../providers/AuthProvider';
import {
  useInboxEntries,
  useNotificationCenterStore,
} from '../store/useNotificationCenterStore';
import { merRecalibDismissKey } from '../lib/notificationCenter/bannerRules';
import type { InboxEntry } from '../lib/notificationCenter/types';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function InboxScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { status, daysLeft } = useSubscription();
  const { user } = useAuth();

  const entries = useInboxEntries();
  const rebuild = useNotificationCenterStore(s => s.rebuild);
  const hydrate = useNotificationCenterStore(s => s.hydrate);
  const markRead = useNotificationCenterStore(s => s.markRead);
  const markAllRead = useNotificationCenterStore(s => s.markAllRead);
  const dismiss = useNotificationCenterStore(s => s.dismiss);
  const setSubscriptionSnapshot = useNotificationCenterStore(s => s.setSubscriptionSnapshot);

  const [merItem, setMerItem] = useState<InboxEntry | null>(null);
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setSubscriptionSnapshot({ status: status ?? null, daysLeft: daysLeft ?? null });
      // Hydrate before rebuilding, and do it here as well as on Home: a tapped
      // push deep-links straight to this screen, so Home may never have mounted
      // to bind the store to the signed-in user. `hydrate` no-ops when the id is
      // already loaded, so the common path pays nothing.
      void hydrate(user?.id ?? null).then(() => rebuild());
      track('notification_center_opened', {});
    }, [rebuild, hydrate, user?.id, setSubscriptionSnapshot, status, daysLeft]),
  );

  const { attention, earlier } = useMemo(() => {
    const attention = entries.filter(e => e.tone === 'clinical' || e.tone === 'action');
    const earlier = entries.filter(e => e.tone !== 'clinical' && e.tone !== 'action');
    return { attention, earlier };
  }, [entries]);

  const unreadCount = entries.reduce((n, e) => (e.read ? n : n + 1), 0);

  // ── Inline actions ────────────────────────────────────────────────────────
  // Two migrated banners resolved themselves with a database write rather than
  // a destination, so the center has to be able to do the same. Both writes are
  // copied from the banner they came from.

  const confirmVetConsult = useCallback(async (entry: InboxEntry) => {
    const petId = entry.petId;
    if (!petId || saving) return;
    setSaving(true);
    try {
      await supabase
        .from('pets')
        .update({ severe_obesity_vet_confirmed_at: new Date().toISOString() })
        .eq('id', petId);
      const ownerId = useActivePetStore.getState().activePet?.owner_id as string | undefined;
      if (ownerId) await useActivePetStore.getState().fetchPet(ownerId, { silent: true });
      track('severe_obesity_vet_confirmed', { source: 'notification_center' });
      haptic.success();
      await rebuild({ includeRemote: false });
    } catch {
      // Left in place on failure so the owner can retry. A vet-consent gate
      // that silently disappears after a failed write is the worst outcome
      // available here.
    } finally {
      setSaving(false);
    }
  }, [rebuild, saving]);

  const acceptMer = useCallback(async (entry: InboxEntry) => {
    const petId = entry.petId;
    const newKcal = Number(entry.meta?.new_kcal ?? 0);
    if (!petId || !newKcal || saving) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('pets')
        .update({ target_daily_calories: newKcal })
        .eq('id', petId);
      if (error) throw error;

      const pet = useActivePetStore.getState().activePet;
      if (pet) useActivePetStore.getState().updatePetWeight(pet.current_weight_kg, newKcal);
      usePetContextStore.getState().invalidateContext();
      if (pet?.owner_id) {
        await useActivePetStore.getState().fetchPet(pet.owner_id, { silent: true });
      }
      // Same key the banner used: accepting also starts the 14-day window, so
      // the next observation cycle does not immediately re-ask.
      await AsyncStorage.setItem(merRecalibDismissKey(petId), String(Date.now()));

      track('mer_recalibration_accepted', { source: 'notification_center', new_kcal: newKcal });
      haptic.success();
      setMerItem(null);
      await rebuild({ includeRemote: false });
    } catch {
      // Kept open so the owner can retry.
    } finally {
      setSaving(false);
    }
  }, [rebuild, saving]);

  const onPressEntry = useCallback(
    (entry: InboxEntry) => {
      haptic.select();
      markRead(entry.id);
      track('notification_center_item_tapped', {
        source: entry.source,
        tone: entry.tone,
        item: entry.id,
      });

      // The win-back offer's own funnel. Tracked here rather than left to the
      // generic event above because "did the quiet second surface do anything"
      // is a question about the offer, and answering it from a shared event
      // means filtering on an id substring in every query that asks.
      if (entry.id.startsWith('runtime:pro_offer:')) {
        track('pro_offer_inbox_tapped', {
          cohort: (entry.meta?.cohort as string) ?? null,
          config_version: (entry.meta?.config_version as number) ?? null,
        });
      }

      if (entry.action === 'review_mer_recalibration') {
        setMerItem(entry);
        return;
      }
      if (entry.action === 'confirm_vet_consult') {
        void confirmVetConsult(entry);
        return;
      }

      // Walk tracking is free on every plan. The one-shot intent still matters:
      // a bare remount of /walk must never start a new walk on its own.
      if (entry.route === '/walk') {
        armWalkStart();
        router.push('/walk' as never);
        return;
      }

      if (entry.route) router.push(entry.route as never);
    },
    [confirmVetConsult, markRead, router],
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button">
          <MaterialIcons name="arrow-back" size={22} color={color.ink} />
        </Pressable>
        <Text style={styles.headerTitle}>Notifications</Text>
        <Pressable
          onPress={() => router.push('/notifications' as never)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Notification settings"
        >
          <MaterialIcons name="settings" size={20} color={color.slate} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + space.xxxl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {entries.length === 0 ? (
          <View style={styles.empty}>
            <MaterialIcons name="notifications-none" size={30} color={color.slateFaint} />
            <Text style={styles.emptyTitle}>Nothing needs you right now</Text>
            <Text style={styles.emptyBody}>
              Reminders, health notes and updates will collect here.
            </Text>
          </View>
        ) : (
          <>
            {unreadCount > 0 && (
              <Pressable
                onPress={() => { haptic.select(); markAllRead(); }}
                style={styles.markAll}
                accessibilityRole="button"
              >
                <Text style={styles.markAllText}>Mark all as read</Text>
              </Pressable>
            )}

            <Section
              label="NEEDS ATTENTION"
              entries={attention}
              onPress={onPressEntry}
              onDismiss={dismiss}
              index={0}
            />
            <Section
              label="EARLIER"
              entries={earlier}
              onPress={onPressEntry}
              onDismiss={dismiss}
              index={1}
            />
          </>
        )}
      </ScrollView>

      {/* MER recalibration — old vs new, the same confirmation the banner
          showed. The plan is never mutated without this step. */}
      <Modal visible={!!merItem} transparent animationType="fade" onRequestClose={() => setMerItem(null)}>
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Update the daily target?</Text>
            <Text style={styles.modalBody}>{merItem?.body}</Text>
            <View style={styles.compareRow}>
              <View style={styles.compare}>
                <Text style={styles.compareLabel}>Current</Text>
                <Text style={styles.compareValue}>{String(merItem?.meta?.old_kcal ?? '—')}</Text>
                <Text style={styles.compareUnit}>kcal/day</Text>
              </View>
              <MaterialIcons name="arrow-forward" size={18} color={color.slateFaint} />
              <View style={styles.compare}>
                <Text style={styles.compareLabel}>Suggested</Text>
                <Text style={styles.compareValue}>{String(merItem?.meta?.new_kcal ?? '—')}</Text>
                <Text style={styles.compareUnit}>kcal/day</Text>
              </View>
            </View>
            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalSecondary}
                onPress={() => {
                  if (merItem) dismiss(merItem.id);
                  setMerItem(null);
                }}
                accessibilityRole="button"
              >
                <Text style={styles.modalSecondaryText}>Not now</Text>
              </Pressable>
              <Pressable
                style={[styles.modalPrimary, saving && styles.modalPrimaryDisabled]}
                onPress={() => merItem && acceptMer(merItem)}
                disabled={saving}
                accessibilityRole="button"
              >
                <Text style={styles.modalPrimaryText}>
                  {saving ? 'Updating' : 'Update target'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Section({
  label,
  entries,
  onPress,
  onDismiss,
  index,
}: {
  label: string;
  entries: InboxEntry[];
  onPress: (entry: InboxEntry) => void;
  onDismiss: (id: string) => void;
  index: number;
}) {
  if (entries.length === 0) return null;
  return (
    <Reanimated.View entering={entrance(index)}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionLabel}>{label}</Text>
        <View style={styles.sectionRule} />
      </View>
      {entries.map(entry => (
        <Row key={entry.id} entry={entry} onPress={onPress} onDismiss={onDismiss} />
      ))}
    </Reanimated.View>
  );
}

/**
 * One item, in the nudge card's language.
 *
 * Deliberately the same object the retired `NudgeCard` and Up next row were:
 * navy card, round tinted icon chip, coloured title over a slate line. These
 * cards were the app's voice for two years of surfaces; the center inherits
 * that rather than inventing a list style of its own.
 *
 * Read is the one thing the card had no notion of, since a nudge was only ever
 * shown once. A read row drops the navy for plain paper — the strongest
 * available "handled" signal that does not rely on a marker the eye has to hunt
 * for down a list.
 */
function Row({
  entry,
  onPress,
  onDismiss,
}: {
  entry: InboxEntry;
  onPress: (entry: InboxEntry) => void;
  onDismiss: (id: string) => void;
}) {
  const clinical = entry.tone === 'clinical';
  const unread = !entry.read;
  // Red only ever means "a vet should be involved". Everything else keeps the
  // brand yellow, so red never becomes the colour the inbox simply is.
  const accent = clinical ? color.error : color.yellow;

  return (
    <Pressable
      onPress={() => onPress(entry)}
      style={({ pressed }) => [
        styles.row,
        unread ? styles.rowUnread : styles.rowRead,
        clinical && unread && styles.rowClinical,
        pressed && styles.rowPressed,
      ]}
      accessibilityRole={clinical ? 'alert' : 'button'}
      accessibilityLabel={`${entry.title}. ${entry.body}`}
    >
      <View
        style={[
          styles.rowIcon,
          unread
            ? { backgroundColor: clinical ? 'rgba(220,38,38,0.16)' : color.yellowSoft }
            : styles.rowIconRead,
        ]}
      >
        <MaterialIcons
          name={entry.icon as never}
          size={20}
          color={unread ? accent : color.slateMuted}
        />
      </View>

      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, unread ? { color: accent } : styles.rowTitleRead]}>
          {entry.title}
        </Text>
        <Text style={styles.rowBody}>{entry.body}</Text>
        <Text style={styles.rowMeta}>{relativeTime(entry.createdAt)}</Text>
      </View>

      {/* Sticky items have no dismiss affordance at all. Offering one and
          ignoring it would be worse than not offering it. */}
      {entry.sticky ? (
        <MaterialIcons name="chevron-right" size={18} color={color.slateFaint} />
      ) : (
        <Pressable
          onPress={() => onDismiss(entry.id)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        >
          <MaterialIcons name="close" size={16} color={color.slateFaint} />
        </Pressable>
      )}
    </Pressable>
  );
}

/** Coarse on purpose — an inbox needs "when-ish", not a clock. */
function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'Yesterday' : `${days} days ago`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.surfaceSubtle },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  headerTitle: { ...type.heading, color: color.ink },
  content: { paddingHorizontal: space.lg, paddingTop: space.sm },

  markAll: { alignSelf: 'flex-end', paddingVertical: space.xs, paddingHorizontal: space.xs },
  markAllText: { fontFamily: font.semibold, fontSize: 12.5, color: color.slate },

  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.lg,
    marginBottom: space.md,
  },
  sectionLabel: {
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: 2.4,
    color: color.slateFaint,
  },
  sectionRule: { flex: 1, height: 1, backgroundColor: color.hairline },

  // Geometry lifted from the retired NudgeCard: 14pt padding, 12pt gap, 16
  // radius. Same object, now in a list.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.lg,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: space.sm,
    borderWidth: 1,
  },
  rowUnread: {
    backgroundColor: color.navyRaised,
    borderColor: 'transparent',
  },
  // A clinical card is still navy — a light red panel in a column of dark ones
  // would read as a different component rather than a louder one. The hairline
  // and the accent carry the difference.
  rowClinical: {
    borderColor: color.error,
  },
  // Handled: the navy drops away and the card becomes plain paper.
  rowRead: {
    backgroundColor: color.surface,
    borderColor: color.hairline,
    ...makeShadow(2, 8, 0.04),
  },
  rowPressed: { opacity: 0.85 },

  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconRead: { backgroundColor: color.track },

  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: font.bold, fontSize: 15, letterSpacing: -0.2 },
  rowTitleRead: { color: color.ink },
  // Slate reads correctly on both the navy card and the paper one, which is
  // what lets a single body style serve read and unread.
  rowBody: {
    fontFamily: font.medium,
    fontSize: 12,
    lineHeight: 16,
    color: color.slateFaint,
    marginTop: 2,
  },
  rowMeta: { fontFamily: font.medium, fontSize: 11, color: color.slateFaint, marginTop: 6 },

  empty: { alignItems: 'center', paddingVertical: space.xxxl * 2, gap: space.sm },
  emptyTitle: { fontFamily: font.bold, fontSize: 15, color: color.ink, marginTop: space.sm },
  emptyBody: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 19,
    color: color.slateMuted,
    textAlign: 'center',
    maxWidth: 260,
  },

  modalScrim: {
    flex: 1,
    backgroundColor: 'rgba(7, 32, 42, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: color.surface,
    borderRadius: radius.xl,
    padding: space.lg,
  },
  modalTitle: { ...type.heading, color: color.ink },
  modalBody: {
    ...type.body,
    fontSize: 13.5,
    lineHeight: 20,
    color: color.slate,
    marginTop: space.sm,
  },
  compareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    marginTop: space.lg,
  },
  compare: { flex: 1, alignItems: 'center' },
  compareLabel: { ...type.caption, color: color.slateMuted },
  compareValue: { fontFamily: font.display, fontSize: 30, color: color.ink, marginTop: 2 },
  compareUnit: { fontFamily: font.medium, fontSize: 11, color: color.slateFaint },
  modalActions: { flexDirection: 'row', gap: space.md, marginTop: space.xl },
  modalSecondary: {
    flex: 1,
    paddingVertical: space.md,
    alignItems: 'center',
    borderRadius: radius.pill,
    backgroundColor: color.track,
  },
  modalSecondaryText: { fontFamily: font.semibold, fontSize: 14, color: color.slate },
  modalPrimary: {
    flex: 1,
    paddingVertical: space.md,
    alignItems: 'center',
    borderRadius: radius.pill,
    backgroundColor: color.navy,
  },
  modalPrimaryDisabled: { opacity: 0.6 },
  modalPrimaryText: { fontFamily: font.bold, fontSize: 14, color: color.cream },
});
