/**
 * NotificationPrimer — the in-app ask that precedes the OS permission prompt.
 *
 * iOS grants exactly one `requestPermissionsAsync()` prompt per install. Until
 * August 2026 Pawtchi spent it the instant a session existed: the prompt landed
 * on the first authed frame, before the owner had seen anything the app could
 * do, and sometimes in the middle of onboarding. Opt-in sat at 9% — 16 valid
 * push tokens across 177 accounts — which capped the reach of every
 * notification the product will ever send.
 *
 * This screen does the asking first, naming the animal and one concrete thing
 * Pawtchi will say. Declining here costs nothing: the OS prompt is never
 * fired, so the owner can be asked again later from Profile. Only "Turn them
 * on" reaches the system dialog.
 */

import { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { color, font, radius, space, type } from '@/constants/design';
import { track } from '@/lib/analytics';

interface Props {
  visible: boolean;
  petName: string;
  /** Where the primer was shown from — reveal, profile, settings. */
  source: string;
  onAccept: () => void;
  onDecline: () => void;
}

export function NotificationPrimer({ visible, petName, source, onAccept, onDecline }: Props) {
  useEffect(() => {
    if (visible) track('notification_primer_shown', { source });
  }, [visible, source]);

  const name = petName?.trim() || 'your companion';

  const accept = () => {
    track('notification_primer_accepted', { source });
    onAccept();
  };

  const decline = () => {
    track('notification_primer_declined', { source });
    onDecline();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={decline}>
      <View style={styles.scrim}>
        <View style={styles.sheet}>
          <View style={styles.iconWrap}>
            <MaterialIcons name="notifications-none" size={26} color={color.navy} />
          </View>

          {/* Sentence case, no exclamation marks, names the animal, ends on an
              action — the same Copy Spec v1 rules copy.test.ts enforces for
              the push strings themselves. */}
          <Text style={styles.title}>Want a nudge for {name}?</Text>
          <Text style={styles.body}>
            Pawtchi can let you know when {name}&apos;s meal window opens, and when a weigh-in is
            due. One a day at most, and quiet overnight.
          </Text>

          <Pressable style={styles.primary} onPress={accept} accessibilityRole="button">
            <Text style={styles.primaryText}>Turn them on</Text>
          </Pressable>

          <Pressable style={styles.secondary} onPress={decline} accessibilityRole="button">
            <Text style={styles.secondaryText}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(7, 32, 42, 0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.xl,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: color.yellowSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  title: {
    ...type.title,
    color: color.ink,
    marginBottom: space.xs,
  },
  body: {
    ...type.body,
    color: color.slate,
    marginBottom: space.lg,
  },
  primary: {
    backgroundColor: color.yellow,
    borderRadius: radius.pill,
    paddingVertical: space.md,
    alignItems: 'center',
  },
  primaryText: {
    fontFamily: font.semibold,
    fontSize: 16,
    color: color.navy,
  },
  secondary: {
    paddingVertical: space.md,
    alignItems: 'center',
  },
  secondaryText: {
    fontFamily: font.medium,
    fontSize: 15,
    color: color.slateMuted,
  },
});
