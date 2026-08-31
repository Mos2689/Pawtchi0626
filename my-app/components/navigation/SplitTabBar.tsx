/**
 * SplitTabBar — a floating record disc and a floating tab pill, side by side.
 *
 * Two separate objects rather than one strip, for the same reason everything on
 * Home floats: the map is the screen, and an opaque bar welded to the bottom
 * edge cuts a band off it. Detached, the map runs to the bottom of the display
 * and the chrome sits on top of it.
 *
 * ── What this replaced, and why ──
 * The previous version was one 40/60 strip: record button left, a five-tab
 * track right that showed only three, with the other two sliding in on a swipe.
 * That arithmetic existed because five tabs will not fit across a phone beside
 * a 64px disc. It worked, but it cost a gesture nobody is told about, hid
 * Health behind a chevron, and left "Hea…" clipped at the right edge on every
 * screenshot.
 *
 * All five fit WITH their labels — see the note on `tabInner`. The trick is
 * that the active chip spans its tab slot instead of hugging its content, so
 * no width goes on chip padding and the longest label ("Activity") has room.
 *
 * Cats get the pill alone: walks are dogs-only, so there is no disc.
 */

import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { color, font, makeShadow, radius, space } from '../../constants/design';
import { haptic } from '../../lib/haptics';
import { track as trackEvent } from '../../lib/analytics';
import { armWalkStart } from '../../lib/walk/walkStartIntent';
import { useWalkEnabled } from '../../hooks/useWalkEnabled';
import {
  selectHasUrgentUnread,
  selectUnreadCount,
  useNotificationCenterStore,
} from '../../store/useNotificationCenterStore';

/**
 * The tabs in the pill, in order. Explicit rather than derived from navigation
 * state because several routes under (tabs) are registered with `href: null`
 * (community, shop, explore) and must never appear — reading state directly
 * would surface them the moment that convention changed.
 *
 * Profile was briefly a chevron at the end, which cost nearly a tab's width in
 * padding and divider anyway — so it earns its slot rather than taking new
 * space.
 */
/**
 * Activity sits before Meal deliberately: this is a walk-first product, so the
 * two tabs nearest the record disc are the two about movement.
 *
 * This array alone decides what the bar shows and in what order — it is not
 * required to match the `<ExpoTabs.Screen>` declaration order in
 * (tabs)/_layout.tsx, which only sets up the routes.
 */
const TAB_ORDER = ['index', 'activity', 'meal', 'health', 'profile'] as const;

const DISC = 56;
const COLLAR = 4;
const PILL_H = 60;

/**
 * How much room a screen must leave at its bottom to clear this bar.
 *
 * The bar floats over the content (see the note on `wrap` below), so nothing is
 * laid out above it any more and every scrolling screen owes its last row this
 * much space or the bar sits on top of it. Add the safe-area inset on top at
 * the call site — this is the chrome only, deliberately, so callers that
 * already handle insets do not double them.
 *
 * This is the disc's full outer height (the taller of the two floating
 * objects) plus a small breathing gap. It is now the ONLY clearance in play:
 * an earlier version of this bar sat in the flex column, so React Navigation
 * reserved its height as well and every screen got the gap twice.
 */
export const TAB_BAR_CLEARANCE = DISC + COLLAR * 2 + space.sm;

export function SplitTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const walkEnabled = useWalkEnabled();
  // The bell itself lives on Home. This dot is how it stays discoverable from
  // the other four tabs now that nudges no longer appear on them — without it,
  // an owner on Health has no way to know anything is waiting.
  const unreadCount = useNotificationCenterStore(selectUnreadCount);
  const urgentUnread = useNotificationCenterStore(selectHasUrgentUnread);

  const onRecord = useCallback(() => {
    haptic.medium();
    trackEvent('home_record_tapped', { has_access: true, access_tier: 'free' });
    // The one-shot intent is a safety guard against accidental remounts, not a
    // subscription gate. Walk tracking is available on every plan.
    armWalkStart();
    router.push('/walk' as never);
  }, [router]);

  const navigateTo = useCallback(
    (name: string) => {
      const route = state.routes.find(r => r.name === name);
      if (!route) return;
      const focused = state.routes[state.index]?.key === route.key;

      const event = navigation.emit({
        type: 'tabPress',
        target: route.key,
        canPreventDefault: true,
      });
      if (event.defaultPrevented) return;
      if (!focused) navigation.navigate(route.name);
    },
    [navigation, state],
  );

  const renderTab = (name: string) => {
    const route = state.routes.find(r => r.name === name);
    if (!route) return null;
    const descriptor = descriptors[route.key];
    if (!descriptor) return null;

    const { options } = descriptor;
    const focused = state.routes[state.index]?.key === route.key;
    const tint = focused ? color.ink : color.slateFaint;
    // Home only — it is the tab that carries the bell.
    const showDot = name === 'index' && unreadCount > 0;

    return (
      <Pressable
        key={route.key}
        onPress={() => navigateTo(name)}
        style={styles.tab}
        accessibilityRole="button"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={
          showDot
            ? `${options.title ?? route.name}, ${unreadCount} unread notifications`
            : (options.title ?? route.name)
        }
      >
        <View style={[styles.tabInner, focused && styles.tabInnerActive]}>
          {options.tabBarIcon?.({ focused, color: tint, size: 22 })}
          <Text style={[styles.label, { color: tint }]} numberOfLines={1}>
            {options.title ?? route.name}
          </Text>
          {/* A dot, never a number. The count belongs on the bell; repeating it
              down here would make two places to read the same fact. */}
          {showDot && (
            <View
              style={[
                styles.unreadDot,
                { backgroundColor: urgentUnread ? color.error : color.yellow },
              ]}
              pointerEvents="none"
            />
          )}
        </View>
      </Pressable>
    );
  };

  return (
    // `box-none` so the gap between the disc and the pill falls through to
    // whatever is behind — on Home, that is the map.
    <View
      style={[styles.wrap, { paddingBottom: insets.bottom + space.xs }]}
      pointerEvents="box-none"
    >
      {walkEnabled && (
        <Pressable
          onPress={onRecord}
          accessibilityRole="button"
          accessibilityLabel="Start a walk"
          accessibilityHint="Starts tracking a walk"
        >
          <View style={styles.disc}>
            <View style={styles.glyph} />
          </View>
        </Pressable>
      )}

      <View style={styles.pill}>{TAB_ORDER.map(renderTab)}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    /**
     * Absolute, and this is the load-bearing part.
     *
     * BottomTabView renders the tab bar as a FLEX SIBLING below the screens
     * container (`styles.screens` is `flex: 1`). With a custom `tabBar` prop,
     * `tabBarStyle` is only read to compute a height NUMBER for
     * `useBottomTabBarHeight()` — it never takes the bar out of flow. So an
     * in-flow bar always steals its own height from the screen above it, and
     * the screen stops at the bar's top edge no matter what `tabBarStyle` says.
     *
     * That produced two visible bugs at once: the map ended above the bar with
     * the navigator's own background showing through the transparent chrome,
     * and the gap above the rail was doubled — React Navigation reserving the
     * bar's height, plus TAB_BAR_CLEARANCE inside the screen.
     *
     * Positioning our own root absolutely removes it from the column, so the
     * screen fills the full height and this genuinely floats on top of it.
     */
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    // No background and no border: this is two floating objects, not a bar.
    // Whatever the screen draws runs underneath it to the display edge.
    backgroundColor: 'transparent',
  },
  disc: {
    width: DISC + COLLAR * 2,
    height: DISC + COLLAR * 2,
    borderRadius: (DISC + COLLAR * 2) / 2,
    backgroundColor: color.yellow,
    borderWidth: COLLAR,
    borderColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...makeShadow(4, 16, 0.45, '#C4C600'),
  },
  glyph: {
    width: 20,
    height: 20,
    borderRadius: 10,
    // Discovery, not effort — see the `electric` note in constants/design.ts.
    backgroundColor: color.electric,
  },
  pill: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    height: PILL_H,
    borderRadius: radius.pill,
    backgroundColor: color.surface,
    paddingHorizontal: 3,
    ...makeShadow(6, 18, 0.14),
  },
  tab: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * Stretches to the tab's full slot rather than hugging its content, and that
   * is what lets the labels back in.
   *
   * A content-hugging chip charges 10pt of padding either side, which pushed
   * "Activity" over the ~57pt each tab gets and truncated it. Spanning the slot
   * spends nothing on padding, so the label has the whole width to sit in.
   */
  tabInner: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: 6,
    marginHorizontal: 2,
    borderRadius: radius.lg,
  },
  tabInnerActive: {
    backgroundColor: color.surfaceSubtle,
  },
  label: {
    fontFamily: font.semibold,
    fontSize: 10,
  },
  /**
   * Pinned to the icon's top-right rather than the chip's corner, so it reads as
   * belonging to Home rather than floating in the pill. Absolute, so it cannot
   * change the tab's measured width — the labels only just fit as it is.
   */
  unreadDot: {
    position: 'absolute',
    top: 4,
    right: 12,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: color.surface,
  },
});
