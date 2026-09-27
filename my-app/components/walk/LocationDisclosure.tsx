/**
 * The prominent in-app disclosure, shown before the OS location prompt.
 *
 * ── Why it is a component and not two copies ───────────────────────────────
 *
 * Google Play's Location Permissions policy requires this screen before the
 * runtime request whenever an app collects location in the background — which
 * a tracked walk does on both platforms, via the Android foreground service
 * and iOS's background location mode. It is a compliance surface: the app has
 * been rejected over permissions before.
 *
 * Two walks can start a recording now — the solo one and a Trail — and if each
 * carried its own copy of this text, one of them would eventually be edited
 * and the other would not. The half that did not get edited is the half a
 * reviewer reads. So there is one.
 *
 * The acknowledgement itself lives in lib/walk/locationDisclosure.ts and is
 * per ACCOUNT, not per device: the system prompt appears once, but a second
 * person signing in on the same phone has not consented to anything.
 */

import { MaterialIcons } from '@expo/vector-icons';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, font, radius, space } from '../../constants/design';

/**
 * Which walk is being started — and the two are NOT the same disclosure.
 *
 * A solo route is private, and the copy says so. A trail route is not: it joins
 * the walk's shared memory through
 * `community_members_read_linked_personal_walks`, where everyone on that walk
 * can read the polyline, the pace, the stops and the place names.
 *
 * This screen used to be shown, unchanged, before both. So the sentence "Only
 * you can see it" was displayed to somebody at the exact moment their route was
 * about to be shared — and `app/community/walk/[walkId]/index.tsx` named this
 * screen as the consent for that sharing. Consent obtained by describing the
 * opposite of what happens is not consent, and a privacy claim that is untrue
 * is worse than one that was never made.
 *
 * A variant rather than a second component, for the reason in the docstring
 * above: two copies means one of them eventually goes stale, and the stale one
 * is the one a reviewer reads.
 */
export type LocationDisclosureVariant = 'solo' | 'trail';

export function LocationDisclosure({
  onContinue,
  onCancel,
  variant = 'solo',
  onReadMore,
}: {
  onContinue: () => void;
  onCancel: () => void;
  variant?: LocationDisclosureVariant;
  /** Opens the trail responsibilities document. Trail variant only. */
  onReadMore?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const trail = variant === 'trail';
  return (
    <View style={[styles.screen, { paddingTop: insets.top + space.xl }]}>
      <Text style={styles.eyebrow}>{trail ? 'WALKING TOGETHER' : 'TRACKED WALK'}</Text>
      <View style={styles.centerFill}>
        <MaterialIcons name="my-location" size={40} color={color.navy} />
        <Text style={styles.title}>Before we start tracking</Text>
        <Text style={styles.body}>
          Pawtchi collects your device’s precise location while a walk is running, to
          measure the route, distance, pace and rest stops.
          {'\n\n'}
          Tracking keeps going in the background so the walk isn’t lost when your screen
          locks — you’ll see an ongoing notification on Android, or the location
          indicator on iOS — and stops when the walk ends.
          {'\n\n'}
          {trail ? (
            <Text>
              On a shared walk your route is saved and joins that walk’s memory, where
              everyone who walked it can see where you went, how fast, and where you
              stopped. Your live position is visible to them while the walk is on, and
              stops when it finishes. It is never public, and never used for advertising.
            </Text>
          ) : (
            <Text>
              Your route is saved to your pet’s history so you can see it later. Because
              walks usually start at home, it can show roughly where you live. Only you can
              see it, and it is never used for advertising.
            </Text>
          )}
          {'\n\n'}
          Outside a walk, Pawtchi reads your location in one other place: to centre the
          map on your home screen, and only until your first walk draws itself. It is
          never collected continuously when a walk isn’t running.
        </Text>
        {trail && onReadMore ? (
          <TouchableOpacity onPress={onReadMore} accessibilityRole="link" hitSlop={8}>
            <Text style={styles.readMore}>How meetups work, and who is responsible</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={styles.primaryBtn} onPress={onContinue}>
          <Text style={styles.primaryBtnText}>Continue</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryBtn} onPress={onCancel}>
          <Text style={styles.secondaryBtnText}>Not now</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.surface, paddingHorizontal: space.xl },
  eyebrow: { fontFamily: font.bold, fontSize: 11, letterSpacing: 1.6, color: color.slateFaint },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md },
  title: { fontFamily: font.display, fontSize: 26, color: color.ink, textAlign: 'center' },
  body: {
    fontFamily: font.regular,
    fontSize: 13.5,
    lineHeight: 20,
    color: color.slateMuted,
    textAlign: 'left',
  },
  readMore: {
    fontFamily: font.bold,
    fontSize: 13,
    color: color.navy,
    textDecorationLine: 'underline',
    textAlign: 'center',
  },
  primaryBtn: {
    minHeight: 52,
    alignSelf: 'stretch',
    borderRadius: radius.lg,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.lg,
  },
  primaryBtnText: { fontFamily: font.bold, fontSize: 14, color: color.navy },
  secondaryBtn: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  secondaryBtnText: { fontFamily: font.medium, fontSize: 13, color: color.slateMuted },
});
