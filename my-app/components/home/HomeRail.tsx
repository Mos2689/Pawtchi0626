/**
 * HomeRail — the horizontal card rail floating over the map.
 *
 * This is the screen's central idea: browsing your walks IS moving the map.
 * There is no sheet, no panel, nothing that covers the map to show you
 * something. Cards snap, and whichever card is centred tells the map where to
 * look — so the content and the geography are one control instead of two
 * stacked layers arguing over the same screen.
 *
 * Selection fires on momentum end rather than on every scroll frame, because
 * re-framing a native map mid-flick is both expensive and nauseating. The rail
 * settles, then the map moves.
 */

import React, { useCallback, useMemo, useRef } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Reanimated, {
  Extrapolation,
  cancelAnimation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import Svg, { Circle, Polyline } from 'react-native-svg';

import { color, displayLine, font, makeShadow, radius, space } from '../../constants/design';
import { haptic } from '../../lib/haptics';
import { projectRouteToSvg } from '../../lib/walk/routeSvg';
import type { GeoPoint } from '../../lib/walk/geo';
import type { WalkWeather } from '../../lib/walkStory';
import { assessWalkWeather, type WalkWeatherLevel } from '../../lib/home/walkWeatherSafety';
import {
  formatDuration,
  type RailWalkItem,
  type TodayTotals,
} from '../../lib/home/homeRail';
import { formatKm } from '../../lib/pawPrints';
import { BreathingPaw } from '../BreathingPaw';
import {
  CATEGORY_SHORT,
  copy,
  DOG_ACCESS_LABEL,
  displayName,
  formatDistance,
  showsDogAccess,
} from '../../lib/spots/copy';
import type { PawtchiSpot } from '../../lib/spots/types';
import { CATEGORY_ICON } from '../spots/spotVisuals';

// Narrower than the screen on purpose: the next card has to be visibly peeking
// past the right edge, because that peek is the only thing telling anyone the
// rail scrolls at all.
const CARD_W = 190;
const CARD_GAP = 12;
const SNAP = CARD_W + CARD_GAP;
/** The route thumbnail at the top of a walk card. */
const CARD_PAD = 14;
const THUMB_W = CARD_W - CARD_PAD * 2;
const THUMB_H = 62;

/**
 * What the rail actually renders. The today card and the invite card are
 * bookends around the real content: the first says where the day stands, the
 * last is the quiet ask, and neither moves the map (they have no geography).
 */
export type RailEntry =
  | { kind: 'today'; id: string; totals: TodayTotals; weather: WalkWeather | null }
  | { kind: 'walk'; id: string; item: RailWalkItem }
  /**
   * A nearby place from OpenStreetMap. Rides the same rail as walks and sniffs
   * deliberately: browsing IS moving the map here, and a spot needs exactly the
   * same interaction — settle on it, the camera goes there, tap to open it.
   * Giving it a separate floating panel would have covered the map to show
   * something the map is already showing.
   */
  | {
      kind: 'nearby';
      id: string;
      item: PawtchiSpot;
      /**
       * How many of this dog's own walks came through here. Absent means never.
       *
       * Carried on the entry rather than looked up inside the card because the
       * index is built once for the whole list — a per-card lookup would put a
       * distance calculation over every route inside a FlatList renderItem.
       */
      visits?: number;
    }
  | { kind: 'invite'; id: string; petName: string }
  | { kind: 'empty'; id: string; petName: string }
  /** A resolved state that is not a card — empty, error, prompt. */
  | { kind: 'message'; id: string; title: string; body: string; action?: string; onAction?: () => void }
  /**
   * Work in flight. Separate from `message` because a resolved state is static
   * by nature and this one must not be: a card that never changes reads as
   * frozen long before the request has actually failed.
   *
   * Carries its own words because both segments wait, and they are not waiting
   * for the same thing — a rail loading this dog's own walks must not announce
   * that it is "finding spots nearby".
   */
  | {
      kind: 'loading';
      id: string;
      title: string;
      /** Cycled under the title. Describes the situation, never fake steps. */
      lines: string[];
      /** Shown once the wait passes the point where people assume breakage. */
      slowLine: string;
      /**
       * Electric is the discovery accent and belongs to Spots alone; the walk
       * feed breathes in the brand's own working colour.
       */
      tone: 'spot' | 'walk';
    }
  /**
   * A ghost of a card that is about to exist. Trails the loading card so the
   * rail shows the SHAPE of what is coming — which is more informative than any
   * amount of copy, and is what makes the wait feel like filling rather than
   * hanging.
   */
  | { kind: 'ghost'; id: string; index: number };

interface HomeRailProps {
  entries: RailEntry[];
  onSelect: (entry: RailEntry) => void;
  onOpenWalk: (walkId: string) => void;
  onOpenSpot?: (spot: PawtchiSpot) => void;
  onInvite: () => void;
}

export function HomeRail({ entries, onSelect, onOpenWalk, onOpenSpot, onInvite }: HomeRailProps) {
  const lastIndex = useRef(0);
  const reducedMotion = useReducedMotion();

  // Drives the focus effect below. Read on the UI thread, so the card under
  // your thumb grows with the drag rather than snapping after it.
  const scrollX = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler(e => {
    scrollX.value = e.contentOffset.x;
  });

  const onMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const index = Math.round(e.nativeEvent.contentOffset.x / SNAP);
      if (index === lastIndex.current) return;
      lastIndex.current = index;
      const entry = entries[index];
      if (!entry) return;
      haptic.select();
      onSelect(entry);
    },
    [entries, onSelect],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: RailEntry; index: number }) => {
      const card = (() => {
        switch (item.kind) {
          case 'today':
            return <TodayCard totals={item.totals} weather={item.weather} />;
          case 'walk':
            return <WalkCard item={item.item} onPress={() => onOpenWalk(item.item.id)} />;
          case 'nearby':
            return (
              <NearbySpotCard
                item={item.item}
                visits={item.visits ?? 0}
                onPress={() => onOpenSpot?.(item.item)}
              />
            );
          case 'invite':
            return <InviteCard petName={item.petName} onPress={onInvite} />;
          case 'empty':
            return <EmptyCard petName={item.petName} />;
          case 'message':
            return (
              <MessageCard
                title={item.title}
                body={item.body}
                action={item.action}
                onAction={item.onAction}
              />
            );
          case 'loading':
            return (
              <LoadingCard
                title={item.title}
                lines={item.lines}
                slowLine={item.slowLine}
                tone={item.tone}
              />
            );
          case 'ghost':
            return <GhostCard index={item.index} />;
        }
      })();
      return (
        <FocusSlot index={index} scrollX={scrollX} reducedMotion={reducedMotion}>
          {card}
        </FocusSlot>
      );
    },
    [onOpenWalk, onOpenSpot, onInvite, scrollX, reducedMotion],
  );

  const keyExtractor = useCallback((e: RailEntry) => e.id, []);

  return (
    <Reanimated.FlatList
      data={entries}
      horizontal
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      showsHorizontalScrollIndicator={false}
      decelerationRate="fast"
      snapToInterval={SNAP}
      snapToAlignment="start"
      onScroll={onScroll}
      scrollEventThrottle={16}
      onMomentumScrollEnd={onMomentumEnd}
      contentContainerStyle={styles.content}
      ItemSeparatorComponent={Separator}
    />
  );
}

/**
 * The card in focus is bigger.
 *
 * Every slot keeps the same width so snapping stays exact — it is the CARD
 * inside that scales, driven by how far the slot sits from the rail's resting
 * position. Varying the slot widths instead would have meant hand-computing
 * snap offsets, and any drift there strands cards half off the screen.
 */
function FocusSlot({
  index,
  scrollX,
  reducedMotion,
  children,
}: {
  index: number;
  scrollX: SharedValue<number>;
  reducedMotion: boolean;
  children: React.ReactNode;
}) {
  const style = useAnimatedStyle(() => {
    if (reducedMotion) return {};
    const distance = Math.abs(scrollX.value / SNAP - index);
    return {
      transform: [
        { scale: interpolate(distance, [0, 1], [1, 0.88], Extrapolation.CLAMP) },
      ],
      opacity: interpolate(distance, [0, 1], [1, 0.72], Extrapolation.CLAMP),
    };
  });

  return <Reanimated.View style={style}>{children}</Reanimated.View>;
}

function Separator() {
  return <View style={{ width: CARD_GAP }} />;
}

function Card({ children, onPress, label }: {
  children: React.ReactNode;
  onPress?: () => void;
  label?: string;
}) {
  if (!onPress) return <View style={styles.card}>{children}</View>;
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.88}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {children}
    </TouchableOpacity>
  );
}

const WEATHER_LEVEL_COLOR: Record<WalkWeatherLevel, string> = {
  good: color.success,
  caution: color.alert,
  avoid: color.error,
};

const WEATHER_LEVEL_ICON: Record<WalkWeatherLevel, 'check' | 'alert' | 'close'> = {
  good: 'check',
  caution: 'alert',
  avoid: 'close',
};

function TodayCard({ totals, weather }: { totals: TodayTotals; weather: WalkWeather | null }) {
  const walkLabel = totals.walks === 1 ? 'walk' : 'walks';
  const distance = `${formatKm(totals.km)} km`;
  const duration = `${totals.minutes} min`;
  const outlook = weather ? assessWalkWeather(weather) : null;
  const weatherLabel = weather && outlook
    ? `${Math.round(weather.tempC)} degrees. ${outlook.label}.`
    : '';

  return (
    <View
      style={[styles.card, styles.todayCard]}
      accessible
      accessibilityLabel={`Today. ${totals.walks} ${walkLabel}, ${distance}, ${duration}. ${weatherLabel}`}
    >
      <View style={styles.todayHeader}>
        <View style={styles.todayHeading}>
          <View style={styles.todayDot} />
          <Text style={styles.todayTitle}>Today</Text>
        </View>
        {weather && outlook ? (
          <View style={styles.todayWeather}>
            <View
              style={[
                styles.todayWeatherSign,
                { backgroundColor: WEATHER_LEVEL_COLOR[outlook.level] },
              ]}
            >
              <MaterialCommunityIcons
                name={WEATHER_LEVEL_ICON[outlook.level]}
                size={10}
                color={color.surface}
              />
            </View>
            <Text style={styles.todayTemperature}>{Math.round(weather.tempC)}°</Text>
            <Text style={styles.todayWeatherLabel}>{outlook.label}</Text>
          </View>
        ) : (
          <View style={styles.todayDaymark}>
            <MaterialCommunityIcons name="thermometer" size={14} color={color.slateMuted} />
          </View>
        )}
      </View>

      <View style={styles.todaySummary}>
        <View style={styles.todayPrimary}>
          <Text style={styles.todayCount}>{totals.walks}</Text>
          <Text style={styles.todayWalkUnit}>{walkLabel}</Text>
        </View>

        <View style={styles.todayDivider} />

        <View style={styles.todayMetrics}>
          <View style={styles.todayMetricRow}>
            <View style={styles.todayMetricIcon}>
              <MaterialCommunityIcons name="map-marker-distance" size={13} color={color.slateMuted} />
            </View>
            <View style={styles.todayMetricCopy}>
              <Text style={styles.todayMetricValue} numberOfLines={1}>{distance}</Text>
              <Text style={styles.todayMetricLabel}>Distance</Text>
            </View>
          </View>

          <View style={styles.todayMetricRow}>
            <View style={styles.todayMetricIcon}>
              <MaterialCommunityIcons name="clock-outline" size={13} color={color.slateMuted} />
            </View>
            <View style={styles.todayMetricCopy}>
              <Text style={styles.todayMetricValue} numberOfLines={1}>{duration}</Text>
              <Text style={styles.todayMetricLabel}>Time</Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

function WalkCard({ item, onPress }: { item: RailWalkItem; onPress: () => void }) {
  return (
    <Card onPress={onPress} label={`${item.title}. Open walk.`}>
      {/* The shape of the walk, drawn from its own route — the thing that makes
          a card recognisably *that* walk rather than a row of numbers. */}
      <RouteThumb route={item.route} />
      <Text style={styles.title} numberOfLines={1}>
        {item.title}
      </Text>
      <MetaRow
        items={[
          { text: `${formatKm(item.km)} km` },
          { text: `${item.minutes} min` },
          ...(item.sniffCount > 0
            ? [{ text: `${item.sniffCount} sniffs`, tone: 'found' as const }]
            : []),
        ]}
      />
    </Card>
  );
}


/**
 * A nearby place. The compact preview the brief asks for, in rail form.
 *
 * Shows only what we know: the name (or its category, never an OSM id), the
 * distance, and the dog-access line exactly as classify.ts decided it — which
 * for most parks will read "Dog access not confirmed". That line is the whole
 * reason this card is worth trusting, so it gets its own row rather than being
 * squeezed into the meta strip with the distance.
 */
function NearbySpotCard({
  item,
  visits,
  onPress,
}: {
  item: PawtchiSpot;
  visits: number;
  onPress: () => void;
}) {
  const title = displayName(item.name, item.category);
  const distance = formatDistance(item.distanceMeters);
  return (
    <Card onPress={onPress} label={`${title}. ${DOG_ACCESS_LABEL[item.dogAccess]}. Open details.`}>
      <View style={[styles.thumb, styles.thumbSpot]}>
        <MaterialCommunityIcons
          name={CATEGORY_ICON[item.category]}
          size={22}
          color={color.slateMuted}
        />
        {/* A corner mark rather than another line of text: on a card this size
            the name and the access line are what have to be readable, and
            "we've been here" is a glance, not a sentence. */}
        {visits > 0 && (
          <View style={styles.visitedMark}>
            <MaterialCommunityIcons name="paw" size={10} color={color.navy} />
          </View>
        )}
      </View>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <MetaRow
        items={[
          { text: CATEGORY_SHORT[item.category] },
          ...(distance ? [{ text: distance }] : []),
        ]}
      />
      {/* Only where the question means something — a public tap has no dog
          policy, and captioning forty of them teaches people to stop reading
          the line that matters on the park. */}
      {showsDogAccess(item.category) && (
        <Text style={styles.accessLine} numberOfLines={1}>
          {DOG_ACCESS_LABEL[item.dogAccess]}
        </Text>
      )}
    </Card>
  );
}

/**
 * A resolved state that is not a place: nothing nearby, a failed load, or a
 * request for location.
 *
 * Lives in the rail rather than as an overlay so the map stays uncovered and
 * the screen keeps exactly one shape. An error that replaces the whole surface
 * would also throw away the map, which is still perfectly useful.
 */
function MessageCard({
  title,
  body,
  action,
  onAction,
}: {
  title: string;
  body: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.messageTitle}>{title}</Text>
      <Text style={styles.messageBody} numberOfLines={3}>
        {body}
      </Text>
      {!!action && !!onAction && (
        <TouchableOpacity
          style={styles.messageAction}
          onPress={onAction}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={action}
        >
          <Text style={styles.messageActionText}>{action}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

/**
 * The lead card while spots are being fetched.
 *
 * Three things carry the wait, and none of them is a progress bar. A
 * determinate bar would have to invent a number: the request is a call to a
 * volunteer-run service that has answered anywhere between 1.5 and 14 seconds
 * in testing, and a bar that stalls near the end is worse than no bar.
 *
 *   1. A breathing paw — the app's own "working" signal (Living Paw motion
 *      language), which fires one heartbeat when it settles.
 *   2. A line of copy that cycles, so the card visibly changes even when the
 *      network has nothing new to say.
 *   3. After eight seconds, an honest note naming the slow part.
 */
function LoadingCard({
  title,
  lines,
  slowLine,
  tone,
}: {
  title: string;
  lines: string[];
  slowLine: string;
  tone: 'spot' | 'walk';
}) {
  const [line, setLine] = React.useState(0);
  const [slow, setSlow] = React.useState(false);

  React.useEffect(() => {
    const cycle = setInterval(() => setLine(i => (i + 1) % lines.length), 2400);
    // Eight seconds is roughly where a wait stops reading as "loading" and
    // starts reading as "broken".
    const slowTimer = setTimeout(() => setSlow(true), 8000);
    return () => {
      clearInterval(cycle);
      clearTimeout(slowTimer);
    };
  }, [lines.length]);

  return (
    <View style={styles.card}>
      <View style={[styles.thumb, styles.thumbSpot]}>
        <BreathingPaw
          size={26}
          workingColor={tone === 'spot' ? color.electric : color.navy}
        />
      </View>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <Text style={styles.messageBody} numberOfLines={2}>
        {slow ? slowLine : lines[line] ?? lines[0]}
      </Text>
    </View>
  );
}

/**
 * A card-shaped ghost, breathing out of phase with its neighbours.
 *
 * The stagger is the point: three blocks pulsing in unison read as one object
 * flashing, while offset phases read as a queue filling up.
 */
function GhostCard({ index }: { index: number }) {
  const reducedMotion = useReducedMotion();
  const pulse = useSharedValue(0.45);

  React.useEffect(() => {
    if (reducedMotion) return;
    pulse.value = withDelay(
      index * 220,
      withRepeat(
        withSequence(
          withTiming(0.85, { duration: 700 }),
          withTiming(0.45, { duration: 700 }),
        ),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(pulse);
  }, [index, pulse, reducedMotion]);

  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Reanimated.View style={[styles.card, style]} pointerEvents="none">
      <View style={[styles.thumb, styles.thumbGhost]} />
      <View style={[styles.ghostBar, { width: '78%' }]} />
      <View style={[styles.ghostBar, { width: '46%' }]} />
    </Reanimated.View>
  );
}

function InviteCard({ petName, onPress }: { petName: string; onPress: () => void }) {
  return (
    <Card onPress={onPress} label={`Invite a friend for ${petName}`}>
      <View style={[styles.thumb, styles.thumbInvite]}>
        <MaterialIcons name="group-add" size={22} color={color.navy} />
      </View>
      <Text style={styles.title} numberOfLines={1}>
        A friend for {petName}
      </Text>
      <MetaRow items={[{ text: 'Pawtchi is better shared' }]} />
    </Card>
  );
}

function EmptyCard({ petName }: { petName: string }) {
  return (
    <Card>
      <View style={[styles.thumb, styles.thumbSpot]}>
        <MaterialCommunityIcons name="paw" size={22} color={color.slateFaint} />
      </View>
      <Text style={styles.title} numberOfLines={1}>
        No walks yet
      </Text>
      <MetaRow items={[{ text: `${petName}'s map fills in as you walk` }]} />
    </Card>
  );
}

/**
 * The stat line under a card title.
 *
 * Inline and small on purpose. These are supporting detail for a card the size
 * of a business card — stacking each number over its own label turned three
 * facts into a block as tall as the thumbnail and made every card shout.
 */
function MetaRow({ items }: { items: { text: string; tone?: 'found' }[] }) {
  return (
    <View style={styles.metaRow}>
      {items.map(item => (
        <Text
          key={item.text}
          style={[styles.meta, item.tone === 'found' && styles.metaFound]}
          numberOfLines={1}
        >
          {item.text}
        </Text>
      ))}
    </View>
  );
}

/**
 * The walk drawn as itself — the same route projection the gallery and the
 * share cards use, so one walk looks like one walk everywhere in the app.
 *
 * A route too patchy to draw gets a quiet paw rather than an empty box: a blank
 * rectangle reads as a loading failure, and the walk still happened.
 */
function RouteThumb({ route }: { route: GeoPoint[] | null }) {
  const proj = useMemo(
    () => (route && route.length >= 2 ? projectRouteToSvg(route, THUMB_W, THUMB_H, 12) : null),
    [route],
  );

  return (
    <View style={styles.thumb}>
      {proj ? (
        <Svg width={THUMB_W} height={THUMB_H}>
          <Polyline
            points={proj.points}
            fill="none"
            stroke={color.yellow}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {proj.start && <Circle cx={proj.start.x} cy={proj.start.y} r={3} fill={color.cream} />}
        </Svg>
      ) : (
        <MaterialCommunityIcons name="paw" size={20} color={color.hairlineOnNavy} />
      )}
    </View>
  );
}


export { CARD_W, formatDuration };

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: space.md,
  },
  card: {
    width: CARD_W,
    backgroundColor: color.surface,
    borderRadius: 20,
    padding: CARD_PAD,
    gap: 6,
    ...makeShadow(6, 20, 0.14),
  },
  // Navy, because the route on it is brand yellow and the brand book is
  // explicit that yellow does not hold as ink on a light ground — as a thin
  // 2.5px line on pale paper it all but vanishes. Yellow-on-navy is also how a
  // walk is drawn in the gallery and on share cards, so one walk looks like
  // one walk wherever you meet it.
  thumb: {
    width: THUMB_W,
    height: THUMB_H,
    borderRadius: 12,
    backgroundColor: color.navy,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayCard: {
    minHeight: 130,
    padding: 12,
    gap: 8,
  },
  todayHeader: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  todayHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  todayDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: color.yellow,
  },
  todayTitle: {
    fontFamily: font.bold,
    fontSize: 14,
    lineHeight: 19,
    color: color.ink,
    letterSpacing: -0.2,
  },
  todayDaymark: {
    width: 26,
    height: 26,
    borderRadius: 9,
    backgroundColor: color.yellowSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayWeather: {
    height: 26,
    borderRadius: radius.pill,
    backgroundColor: color.surfaceSubtle,
    paddingLeft: 5,
    paddingRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  todayWeatherSign: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayTemperature: {
    fontFamily: font.bold,
    fontSize: 11,
    lineHeight: 14,
    color: color.ink,
    fontVariant: ['tabular-nums'],
  },
  todayWeatherLabel: {
    fontFamily: font.medium,
    fontSize: 8.5,
    lineHeight: 11,
    color: color.slateMuted,
  },
  todaySummary: {
    height: 74,
    borderRadius: 14,
    backgroundColor: color.surfaceSubtle,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
  },
  todayPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
  },
  todayCount: {
    ...displayLine(36),
    color: color.ink,
    letterSpacing: 0.2,
  },
  todayWalkUnit: {
    fontFamily: font.semibold,
    fontSize: 11.5,
    lineHeight: 16,
    color: color.slateMuted,
    marginBottom: 7,
  },
  todayDivider: {
    width: StyleSheet.hairlineWidth,
    height: 42,
    marginHorizontal: 9,
    backgroundColor: color.hairline,
  },
  todayMetrics: {
    width: 72,
    gap: 6,
  },
  todayMetricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  todayMetricIcon: {
    width: 22,
    height: 22,
    borderRadius: 7,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayMetricCopy: {
    flex: 1,
    minWidth: 0,
  },
  todayMetricValue: {
    fontFamily: font.semibold,
    fontSize: 10.5,
    lineHeight: 13,
    color: color.ink,
    fontVariant: ['tabular-nums'],
  },
  todayMetricLabel: {
    fontFamily: font.regular,
    fontSize: 8.5,
    lineHeight: 11,
    color: color.slateFaint,
  },
  thumbSpot: {
    backgroundColor: color.surfaceSubtle,
  },
  visitedMark: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbGhost: {
    backgroundColor: color.hairline,
  },
  ghostBar: {
    height: 10,
    borderRadius: 5,
    backgroundColor: color.hairline,
    marginTop: 2,
  },
  thumbInvite: {
    backgroundColor: color.yellowSoft,
  },
  /**
   * The dog-access line on a nearby-spot card.
   *
   * Its own row, not a meta chip. For most parks this reads "Dog access not
   * confirmed", and that sentence is the reason the card can be trusted —
   * burying it among the distance chips would make the hedge look like a
   * footnote instead of the claim it is.
   */
  accessLine: {
    fontFamily: font.medium,
    fontSize: 11.5,
    color: color.slateMuted,
    marginTop: 1,
  },
  messageTitle: {
    fontFamily: font.bold,
    fontSize: 14,
    lineHeight: 19,
    color: color.ink,
    letterSpacing: -0.2,
  },
  messageBody: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 17,
    color: color.slateMuted,
  },
  messageAction: {
    alignSelf: 'flex-start',
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginTop: 2,
  },
  messageActionText: {
    fontFamily: font.bold,
    fontSize: 12,
    color: color.ink,
  },
  title: {
    fontFamily: font.bold,
    fontSize: 14,
    lineHeight: 19,
    color: color.ink,
    letterSpacing: -0.2,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: 10,
  },
  meta: {
    fontFamily: font.medium,
    fontSize: 10.5,
    color: color.slateMuted,
    flexShrink: 1,
  },
  // Discovery, not effort — the one place the sanctioned blue appears here.
  metaFound: {
    color: color.electric,
    fontFamily: font.bold,
  },
});
