/**
 * TogetherPanel — the Trails sheet on Home.
 *
 * ── It stopped covering the map, and why that is now honest ────────────────
 *
 * This used to be an opaque panel edge to edge, and the reasoning at the time
 * was sound: a Trail is an arrangement, not a place, so a map underneath a list
 * of arrangements would never move and never answer anything.
 *
 * The meeting-point picker changed that. Every planned walk now carries a real
 * coordinate somebody chose, so the map can show where your trails actually
 * meet — and a map with your Sunday walk pinned on it is answering the only
 * question this screen exists for. The panel became a sheet over that map.
 *
 * ── Two snap points ─────────────────────────────────────────────────────────
 *
 * Collapsed, the sheet shows what is next and gets out of the way of the map.
 * Expanded, it is the list. The handle is a real grip, not decoration — a
 * 44×4 pill at the top of a sheet promises a drag, and a promise like that is
 * either kept or removed.
 *
 * The pan lives on the handle strip ALONE, deliberately. Composing a pan
 * gesture with the list's own scroll means deciding, per frame, whether a
 * downward drag belongs to the sheet or the content, and getting it wrong
 * makes a list that will not scroll or a sheet that will not close. Dragging
 * by the grip is unambiguous on both platforms, and the two tap targets below
 * it (the header row) do the same thing without a gesture at all.
 *
 * Invitations and join requests are NOT here. They are questions rather than
 * arrangements, and two irreversible buttons in the middle of a scrolling list
 * is how somebody declines a friend with their thumb. They live behind the
 * pill on the map — counted there, answered in its own sheet.
 *
 * ── What a card shows, and in what order ───────────────────────────────────
 *
 * One trail leads — see lib/community/upNext.ts for which one and why. The
 * rest are rows. A screen where every trail shouted equally had no hierarchy,
 * and the walk starting in twenty minutes looked exactly like the one somebody
 * might plan a fortnight from now.
 */

import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

import { color, font, makeShadow, space, type } from '../../constants/design';
import { formatDate } from '../../lib/dateFormats';
import { pickUpNext, upNextEyebrow, upNextSubtitle } from '../../lib/community/upNext';
import { connectView, type ConnectStatus } from '../../lib/community/connectStatus';
import type { CommunityPack } from '../../lib/communityWalks';
import { UpNextCard, UpNextSkeleton } from './together/UpNextCard';
import { TrailRow, type TrailBadge } from './together/TrailRow';
import { BreathingPaw } from '../BreathingPaw';

/** How much of the screen the sheet covers at each stop. */
const COLLAPSED_FRACTION = 0.62;
const EXPANDED_FRACTION = 0.9;
/** Past this much of a drag, let go and the sheet changes its mind. */
const SNAP_THRESHOLD = 46;
const SPRING = { damping: 20, stiffness: 190, mass: 0.7 } as const;

export type SheetStop = 'collapsed' | 'expanded';

/**
 * The sheet is its own gesture root.
 *
 * Not an assumption about the app: there is no `GestureHandlerRootView` at the
 * root of this app, and on Android a gesture outside one never fires at all —
 * the drag would simply do nothing, on one platform, silently. WalkCamera
 * reaches the same conclusion from the other direction (a Modal is a separate
 * view hierarchy and cannot inherit a root even where one exists), so every
 * gesture surface here carries its own.
 */
const SheetRoot = Animated.createAnimatedComponent(GestureHandlerRootView);

interface TogetherPanelProps {
  trails: CommunityPack[];
  /**
   * Where the request for `trails` stands — see lib/community/connectStatus.
   * `trails` may be an earlier answer (restored on a cold start); this is what
   * says whether it has been confirmed, and it alone may unlock "nothing".
   */
  status: ConnectStatus;
  /** Ask again, from the error card or the "couldn't refresh" line. */
  onRetry: () => void;
  coverUrls: Record<string, string>;
  /** Each trail's last recorded route, keyed by pack id. Decoration only. */
  routes: Record<string, { lat: number; lng: number }[]>;
  /** A trail's identity colour, shared by its map line and its thumbnail. */
  tintFor: (packId: string) => string;
  viewerId: string | null;
  onOpenTrail: (pack: CommunityPack) => void;
  onOpenWalk: (pack: CommunityPack) => void;
  onCreate: () => void;
  /** Told the height of each stop so the map can frame its pins above it. */
  onStopChange?: (stop: SheetStop, height: number) => void;
  bottomInset: number;
}

// Formatter built once, not once per trail row per render. See lib/dateFormats
// — constructing an Intl.DateTimeFormat measured 44× the cost of using one.
function relativeDay(iso: string | null): string {
  return formatDate(
    iso,
    { weekday: 'short', hour: 'numeric', minute: '2-digit' },
    'Date to be confirmed',
  );
}

export function TogetherPanel({
  trails,
  status,
  onRetry,
  coverUrls,
  routes,
  tintFor,
  viewerId,
  onOpenTrail,
  onOpenWalk,
  onCreate,
  onStopChange,
  bottomInset,
}: TogetherPanelProps) {
  const { height: windowHeight } = useWindowDimensions();
  const collapsedHeight = Math.round(windowHeight * COLLAPSED_FRACTION);
  const expandedHeight = Math.round(windowHeight * EXPANDED_FRACTION);
  const travel = expandedHeight - collapsedHeight;

  const [stop, setStop] = React.useState<SheetStop>('collapsed');
  /** How far the sheet has been pulled UP from its collapsed rest, in px. */
  const lift = useSharedValue(0);
  const liftAtGrab = useSharedValue(0);

  const settle = React.useCallback((next: SheetStop) => {
    setStop(next);
    onStopChange?.(next, next === 'collapsed' ? collapsedHeight : expandedHeight);
  }, [collapsedHeight, expandedHeight, onStopChange]);

  React.useEffect(() => {
    // Re-announce on rotation: the stop has not changed but its height has, and
    // the map is framing its pins against a number that just went stale.
    onStopChange?.(stop, stop === 'collapsed' ? collapsedHeight : expandedHeight);
  }, [collapsedHeight, expandedHeight, onStopChange, stop]);

  const pan = React.useMemo(
    () =>
      Gesture.Pan()
        .onStart(() => {
          liftAtGrab.value = lift.value;
        })
        .onUpdate(event => {
          // Negative translationY is upward, which is more sheet.
          const next = liftAtGrab.value - event.translationY;
          lift.value = Math.min(travel, Math.max(0, next));
        })
        .onEnd(() => {
          const wasUp = liftAtGrab.value > travel / 2;
          const moved = lift.value - liftAtGrab.value;
          const goUp = wasUp ? moved > -SNAP_THRESHOLD : moved > SNAP_THRESHOLD;
          lift.value = withSpring(goUp ? travel : 0, SPRING);
          runOnJS(settle)(goUp ? 'expanded' : 'collapsed');
        }),
    [lift, liftAtGrab, settle, travel],
  );

  const toggle = React.useCallback(() => {
    const goUp = stop === 'collapsed';
    lift.value = withSpring(goUp ? travel : 0, SPRING);
    settle(goUp ? 'expanded' : 'collapsed');
  }, [lift, settle, stop, travel]);

  const sheetStyle = useAnimatedStyle(() => ({
    height: collapsedHeight + lift.value,
  }));

  const now = Date.now();
  const upNext = React.useMemo(() => pickUpNext(trails, now), [trails, now]);
  const view = connectView(status, trails.length > 0);

  const badgeFor = React.useCallback((pack: CommunityPack): TrailBadge => {
    if (viewerId && pack.owner_id === viewerId) return 'hosting';
    if (pack.myStatus && ['coming', 'checked_in', 'walking', 'finished'].includes(pack.myStatus)) {
      return 'going';
    }
    if (pack.myStatus === 'invited') return 'asked';
    return null;
  }, [viewerId]);

  const goingLine = React.useCallback((pack: CommunityPack) => {
    // No denominator. There is no capacity on a walk, and "4 of 6" would be a
    // number this app does not have.
    const going = pack.goingCount ?? 0;
    if (going > 0) return `${going} going`;
    return (pack.memberCount ?? 1) === 1 ? 'just you so far' : `${pack.memberCount} in the pack`;
  }, []);

  return (
    <SheetRoot style={[styles.sheet, sheetStyle]}>
      <GestureDetector gesture={pan}>
        <Animated.View style={styles.grip}>
          <Pressable
            onPress={toggle}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={stop === 'collapsed' ? 'Show all your meetups' : 'Show the map'}
          >
            <View style={styles.handle} />
          </Pressable>
        </Animated.View>
      </GestureDetector>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset + space.xxl }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.upNextWrap}>
          {view.lead === 'skeleton' ? (
            <UpNextSkeleton />
          ) : view.lead === 'error' ? (
            // We asked and could not find out — which is not "nothing booked".
            <UpNextCard
              state="undated"
              eyebrow="COULDN’T CHECK"
              title="We couldn’t reach your meetups"
              subtitle="Check your connection, then try again."
              footnote="Nothing on your side has changed"
              actionLabel="Try again"
              onAction={onRetry}
            />
          ) : (
            <UpNextCard
              state={upNext.state}
              eyebrow={upNextEyebrow(upNext, now)}
              title={upNext.candidate?.walk.title ?? 'Plan a meetup this weekend'}
              subtitle={
                upNext.candidate
                  ? upNextSubtitle(
                      upNext.candidate.walk,
                      upNext.candidate.pack.hostName ?? null,
                      !!viewerId && upNext.candidate.walk.organizer_id === viewerId,
                    )
                  : 'You have no walks booked'
              }
              dogs={upNext.candidate?.pack.dogs}
              footnote={
                upNext.candidate
                  ? goingLine(upNext.candidate.pack)
                  : 'Walk with people you already know'
              }
              actionLabel={
                upNext.state === 'live' ? 'Open' : upNext.state === 'empty' ? 'Host' : 'Details'
              }
              onAction={() => {
                if (!upNext.candidate) { onCreate(); return; }
                if (upNext.state === 'live') { onOpenWalk(upNext.candidate.pack); return; }
                onOpenTrail(upNext.candidate.pack);
              }}
            />
          )}

          {/* What is on screen is an earlier answer — restored from the phone
              on a cold start — and the check is in the air. Quiet on purpose:
              the content is almost always still right, and the note is only
              there so a meetup that changed meanwhile is not taken as final. */}
          {view.showUpdating ? (
            <View style={styles.statusLine} accessibilityLiveRegion="polite">
              <BreathingPaw size={13} workingColor={color.slateMuted} />
              <Text style={styles.statusText}>Updating</Text>
            </View>
          ) : null}
          {view.showRefreshFailed ? (
            <Pressable onPress={onRetry} style={styles.statusLine} accessibilityRole="button" hitSlop={8}>
              <Text style={styles.statusText}>Couldn’t refresh · </Text>
              <Text style={styles.statusAction}>Try again</Text>
            </Pressable>
          ) : null}
        </View>

        {view.showEmptyCta ? (
          <Pressable
            onPress={onCreate}
            style={({ pressed }) => [styles.emptyCta, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Ionicons name="add" size={19} color={color.navy} />
            <Text style={styles.emptyCtaText}>Plan a meetup</Text>
          </Pressable>
        ) : null}

        {trails.length ? (
          <View style={styles.list}>
            {/* The header this replaced sat at the top of the sheet and pushed
                the one urgent thing below the fold. A trail list needs a label,
                not a title — and the label is the natural home for the only
                action that makes a new one. */}
            <View style={styles.sectionHead}>
              <Text style={styles.sectionLabel}>
                YOUR MEETUPS · {trails.length}
              </Text>
              <Pressable
                onPress={onCreate}
                style={({ pressed }) => [styles.add, pressed && styles.pressed]}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Plan a meetup"
              >
                <Ionicons name="add" size={19} color={color.navy} />
              </Pressable>
            </View>
            {trails.map(pack => (
              <TrailRow
                key={pack.id}
                pack={pack}
                coverUrl={pack.coverPath ? coverUrls[pack.coverPath] : undefined}
                route={routes[pack.id]}
                tint={tintFor(pack.id)}
                badge={badgeFor(pack)}
                meta={
                  pack.nextWalk
                    ? `${relativeDay(pack.nextWalk.scheduled_for)} · ${pack.nextWalk.meeting_label}`
                    : 'No walk planned yet'
                }
                footnote={goingLine(pack)}
                onOpen={onOpenTrail}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SheetRoot>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: color.surfaceSubtle,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: 1,
    borderTopColor: color.hairline,
    overflow: 'hidden',
    ...makeShadow(-14, 30, 0.10),
  },
  // A generous strip, not just the pill: 4px of handle is a beautiful target
  // for a cursor and a hopeless one for a thumb.
  grip: { paddingTop: 10, paddingBottom: 6, alignItems: 'center' },
  handle: { width: 44, height: 4, borderRadius: 999, backgroundColor: color.slateFaint },

  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingBottom: 8,
  },
  sectionLabel: { ...type.caption, fontSize: 10.5, letterSpacing: 1.6, color: color.navy },
  add: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 52,
    marginHorizontal: space.lg,
    marginTop: space.lg,
    borderRadius: 17,
    backgroundColor: color.yellow,
  },
  emptyCtaText: { fontFamily: font.bold, fontSize: 14, color: color.navy },
  pressed: { opacity: 0.85 },

  scroll: { paddingBottom: space.xxl },
  upNextWrap: { paddingHorizontal: space.lg, paddingTop: space.sm },
  requestWrap: { marginTop: space.md },
  list: { marginTop: space.lg },

  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: space.sm,
    paddingHorizontal: 4,
  },
  statusText: { ...type.caption, fontSize: 11, letterSpacing: 0.2, color: color.slateMuted },
  statusAction: { ...type.caption, fontSize: 11, letterSpacing: 0.2, color: color.electric },
});
