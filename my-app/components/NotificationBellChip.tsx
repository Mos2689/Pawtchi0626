/**
 * NotificationBellChip — the Home header slot, when notifications are off.
 *
 * Occupies the position PawCoins normally holds, and only while there is
 * something to fix. Once notifications are on it renders nothing and the coin
 * pill comes back, so it can never become permanent furniture.
 *
 * Deliberately not a switch. A two-way toggle in the app's most prominent
 * surface would make turning notifications *off* a single tap, and that damage
 * is asymmetric: an OS-level disable cannot be undone from inside the app, only
 * through a manual trip to system settings. This chip can only ever move a user
 * toward being reachable.
 *
 * It routes by state rather than always landing in the same place, because the
 * three "off" states need three different fixes.
 */

import { Pressable, StyleSheet, Text } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { color, font } from '@/constants/design';

interface Props {
  /** Hidden entirely when false — the caller renders PawCoins instead. */
  visible: boolean;
  /** True when the OS prompt is spent and only system settings can recover. */
  isBlocked: boolean;
  onPress: () => void;
}

export function NotificationBellChip({ visible, isBlocked, onPress }: Props) {
  if (!visible) return null;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
      accessibilityRole="button"
      accessibilityLabel={
        isBlocked
          ? 'Notifications are off in system settings. Opens settings.'
          : 'Notifications are off. Turn them on.'
      }
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <MaterialIcons name="notifications-off" size={15} color={color.surface} />
      <Text style={styles.label}>Turn on</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    // Dimensions match the coin pill it replaces, so the header does not
    // reflow when the chip appears or resolves away.
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    // Solid alert red, no border and no translucency. This sits in the busiest
    // corner of the app against a light header, so a tinted fill would read as
    // decoration rather than as something to act on.
    backgroundColor: color.error,
  },
  chipPressed: {
    opacity: 0.75,
  },
  label: {
    fontFamily: font.semibold,
    fontSize: 13,
    // White on #dc2626 measures 4.83:1, clearing WCAG AA for body text.
    color: color.surface,
  },
});
