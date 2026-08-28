/**
 * KeepsakeViewer — a Walk Memory, presented as a page.
 *
 * The map pin is a thumbnail on a street; this is the photograph, given room.
 *
 * ── Why it does not look like a photo viewer ──
 * A dark scrim with two grey labels is what every image preview on the phone
 * already looks like, and it frames the picture as a FILE being inspected. This
 * is not a file. So the page is white, the headline is set in a serif, the
 * facts sit under a hairline rule, and the whole thing reads as a spread from
 * the dog's biography. The serif is the load-bearing decision: none of the four
 * existing families can carry editorial warmth, which is why
 * `font.memoryTitle` exists and why it is fenced to this one surface.
 *
 * ── Why a peek carousel ──
 * A walk's moments are a sequence, and the neighbours showing at the edges say
 * so before any control does. The centre card is full size and the neighbours
 * recede live against the scroll offset, so depth tracks the finger rather than
 * snapping when the gesture ends.
 *
 * ── Degradation ──
 * Resolution runs the usual ladder. When no image can be produced the card
 * still holds its place in the sequence and still carries its words — the time
 * and place are real facts about a real moment, so a lost photo leaves a page
 * rather than a gap in the film. Sharing is the one thing that genuinely needs
 * the original, so it is disabled rather than failing when there isn't one.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import * as Sharing from 'expo-sharing';
import Reanimated, {
  Extrapolation,
  FadeIn,
  FadeInDown,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { color, font, radius, space } from '../../constants/design';
import { haptic } from '../../lib/haptics';
import { useKeepsakeImage } from '../../hooks/useKeepsakeImage';
import { usePlaceVisitCount } from '../../hooks/usePlaceVisitCount';
import {
  buildKeepsakeCaption,
  type KeepsakeFactKind,
} from '../../lib/walk/keepsakeCaption';
import { cumulativeDistances } from '../../lib/walk/keepsake';
import type { GeoPoint } from '../../lib/walk/geo';
import type { KeepsakeMapPin } from './KeepsakeMapOverlay';

/**
 * What the walk knows, so a photo can be described rather than just shown.
 *
 * Supplied by the screen rather than fetched here: both callers already hold
 * all of it, and re-reading the walk row per photo would be a query to learn
 * something the caller was about to pass in anyway.
 */
export interface KeepsakeWalkContext {
  petId?: string | null;
  petName?: string | null;
  /** The walk's place — "Arpora". */
  placeLabel?: string | null;
  weather?: { tempC: number; label: string } | null;
  /** Used to work out how far in the photo was taken. */
  route?: readonly GeoPoint[];
}

const AnimatedScrollView = Reanimated.createAnimatedComponent(ScrollView);

interface Props {
  /** The moments to page through, in the order they happened. */
  pins: KeepsakeMapPin[] | null;
  /** Which one the tap was on. */
  initialIndex?: number;
  /** Everything needed to caption the photo. Absent means image only. */
  context?: KeepsakeWalkContext;
  onClose: () => void;
}

/** Card width as a share of the screen — the rest is the neighbours peeking. */
const WIDTH_RATIO = 0.79;
/** Portrait, the shape a phone photo actually is. */
const ASPECT = 1.3;
const GAP = 14;
/** How far the neighbours shrink at a full page away. */
const SIDE_SCALE = 0.9;

const FACT_ICON: Record<KeepsakeFactKind, ComponentIconName> = {
  elapsed: 'schedule',
  distance: 'straighten',
  place: 'place',
  weather: 'wb-sunny',
};
type ComponentIconName = React.ComponentProps<typeof MaterialIcons>['name'];

/**
 * The page's words.
 *
 * Its own component because the place-visit count is an async lookup keyed on
 * whichever card is centred — running that hook in the parent would refetch on
 * every scroll frame rather than once per settled photo.
 */
function KeepsakeCaption({
  pin,
  context,
  reduced,
}: {
  pin: KeepsakeMapPin | undefined;
  context?: KeepsakeWalkContext;
  reduced: boolean;
}) {
  const keepsake = pin?.keepsake ?? null;
  const priorVisits = usePlaceVisitCount(context?.petId ?? null, keepsake);

  const caption = useMemo(() => {
    if (!pin) return null;
    const capturedAt = keepsake?.capturedAt ?? null;
    if (capturedAt == null) return null;

    // How far they had walked by the time of the photo. The route index is
    // already the nearest vertex, so the cumulative curve answers it directly.
    const route = context?.route ?? [];
    const index = keepsake?.routeIndex ?? null;
    const distanceM =
      index != null && route.length >= 2
        ? cumulativeDistances(route)[Math.min(index, route.length - 1)] ?? null
        : null;

    return buildKeepsakeCaption({
      capturedAt,
      elapsedS: keepsake?.elapsedS ?? null,
      distanceM,
      petName: context?.petName ?? null,
      placeLabel: context?.placeLabel ?? null,
      weather: context?.weather ?? null,
      priorVisits,
      now: Date.now(),
    });
  }, [pin, keepsake, context, priorVisits]);

  if (!caption) return null;

  return (
    <Reanimated.View
      // Keyed on the moment so the words re-enter when the carousel settles on
      // a new one: the page turning is the point, not a silent text swap.
      key={pin?.id}
      entering={reduced ? undefined : FadeInDown.duration(400)}
      style={styles.page}
      pointerEvents="none"
    >
      <Text style={styles.dateLine}>{caption.dateLine}</Text>

      <Text style={styles.headline} numberOfLines={3}>
        {caption.headline}
        {/* The one spot of brand colour in the type — a full stop that says
            this is a Pawtchi page without a logo having to. */}
        <Text style={styles.headlineStop}>.</Text>
      </Text>

      {caption.facts.length > 0 && (
        <View style={styles.facts}>
          {caption.facts.map((fact, i) => (
            <View key={fact.kind} style={styles.fact}>
              {i > 0 && <View style={styles.factDivider} />}
              <MaterialIcons
                name={FACT_ICON[fact.kind]}
                size={13}
                color={fact.kind === 'place' ? color.electric : color.slateFaint}
              />
              <Text
                style={[styles.factText, fact.kind === 'place' && styles.factPlace]}
                numberOfLines={1}
              >
                {fact.text}
              </Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.rule} />

      {caption.note && (
        <View style={styles.note}>
          <View style={styles.noteBadge}>
            <MaterialCommunityIcons name="paw" size={17} color={color.navy} />
          </View>
          <Text style={styles.noteText}>
            {caption.note.lead}
            <Text style={styles.noteHighlight}>{caption.note.highlight}</Text>
            {caption.note.trail}
          </Text>
        </View>
      )}
    </Reanimated.View>
  );
}

/**
 * One card.
 *
 * Its own component for two reasons: each needs an independent resolution hook
 * (hooks cannot run in a `.map()` body), and each needs its own animated style
 * driven by the shared scroll offset.
 */
function KeepsakeSlide({
  pin,
  index,
  scrollX,
  snap,
  cardW,
  cardH,
}: {
  pin: KeepsakeMapPin;
  index: number;
  scrollX: SharedValue<number>;
  snap: number;
  cardW: number;
  cardH: number;
}) {
  const resolved = useKeepsakeImage(pin.uri ? null : pin.keepsake ?? null);
  const uri = pin.uri ?? resolved.uri;

  const animated = useAnimatedStyle(() => {
    const distance = Math.abs(scrollX.value - index * snap);
    const scale = interpolate(distance, [0, snap], [1, SIDE_SCALE], Extrapolation.CLAMP);
    // Neighbours recede rather than dim to grey: on a white page a dark
    // overlay would read as damage to the print.
    const opacity = interpolate(distance, [0, snap], [1, 0.4], Extrapolation.CLAMP);
    return { transform: [{ scale }], opacity };
  });

  return (
    <Reanimated.View style={[{ width: cardW, height: cardH, marginRight: GAP }, animated]}>
      <View style={styles.card}>
        {uri ? (
          <Image source={{ uri }} style={styles.photo} contentFit="cover" transition={220} />
        ) : (
          <View style={styles.missing}>
            <MaterialIcons name="image-not-supported" size={24} color={color.slateFaint} />
            <Text style={styles.missingText}>No longer on this device</Text>
          </View>
        )}
      </View>
    </Reanimated.View>
  );
}

export function KeepsakeViewer({ pins, initialIndex = 0, context, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();

  const cardW = Math.round(width * WIDTH_RATIO);
  // Capped so the words always have a page to sit on — they are half the
  // artifact, and a tall photo must not push them off the screen.
  // The cap only binds on short screens, which is exactly where centring needs
  // the headroom — so trimming it slightly buys margin where it is scarce and
  // changes nothing on a tall phone.
  const cardH = Math.min(Math.round(cardW * ASPECT), Math.round(height * 0.46));
  const snap = cardW + GAP;
  const side = Math.round((width - cardW) / 2);

  const scrollX = useSharedValue(initialIndex * snap);
  const [index, setIndex] = useState(initialIndex);
  const scrollRef = useRef<ScrollView>(null);

  // A newly-tapped pin re-enters at its own photo, not wherever the last one
  // was left. `animated: false` because this runs as the modal appears.
  useEffect(() => {
    setIndex(initialIndex);
    scrollX.value = initialIndex * snap;
    scrollRef.current?.scrollTo({ x: initialIndex * snap, animated: false });
  }, [pins, initialIndex, snap, scrollX]);

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollX.value = event.contentOffset.x;
  });

  const onSettled = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      setIndex(Math.round(event.nativeEvent.contentOffset.x / snap));
    },
    [snap],
  );

  const current = pins?.[Math.min(index, (pins?.length ?? 1) - 1)];
  // Sharing needs a real file, which only the top rung of the ladder has. A
  // thumbnail is a stand-in for rendering, not something to hand to Instagram.
  const shareable = useKeepsakeImage(
    current?.uri ? null : current?.keepsake ?? null,
  );
  const shareUri = current?.uri ?? (shareable.rung === 'original' ? shareable.uri : null);

  const onShare = useCallback(async () => {
    if (!shareUri) return;
    haptic.tap();
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(shareUri);
      }
    } catch {
      // A share sheet that will not open is not worth an error dialog over a
      // photograph the user can still see.
    }
  }, [shareUri]);

  if (!pins || pins.length === 0) return null;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.canvas}>
        <Reanimated.View
          entering={reduced ? undefined : FadeIn.duration(360)}
          style={[styles.masthead, { paddingTop: insets.top + 10 }]}
        >
          <TouchableOpacity
            onPress={onClose}
            hitSlop={14}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <MaterialIcons name="arrow-back-ios-new" size={20} color={color.navy} />
          </TouchableOpacity>
          <Text style={styles.mastheadText}>WALK MEMORY</Text>
          {/* Balances the back button so the title sits truly centred. */}
          <View style={styles.mastheadSpacer} />
        </Reanimated.View>

        <View style={styles.stage}>
          <AnimatedScrollView
            ref={scrollRef as never}
            horizontal
            showsHorizontalScrollIndicator={false}
            // `snapToInterval` rather than `pagingEnabled`: a page is the screen
            // width, and these cards are narrower than that on purpose.
            snapToInterval={snap}
            snapToAlignment="start"
            decelerationRate="fast"
            disableIntervalMomentum
            contentContainerStyle={{ paddingHorizontal: side }}
            style={{ flexGrow: 0, height: cardH }}
            onScroll={onScroll}
            scrollEventThrottle={16}
            onMomentumScrollEnd={onSettled}
          >
            {pins.map((pin, i) => (
              <KeepsakeSlide
                key={pin.id}
                pin={pin}
                index={i}
                scrollX={scrollX}
                snap={snap}
                cardW={cardW}
                cardH={cardH}
              />
            ))}
          </AnimatedScrollView>

          <KeepsakeCaption pin={current} context={context} reduced={reduced} />
        </View>

        <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
          <TouchableOpacity
            style={[styles.action, !shareUri && styles.actionOff]}
            onPress={onShare}
            disabled={!shareUri}
            accessibilityRole="button"
            accessibilityLabel="Share this moment"
          >
            <MaterialIcons
              name="ios-share"
              size={21}
              color={shareUri ? color.navy : color.slateFaint}
            />
            <Text style={[styles.actionText, !shareUri && styles.actionTextOff]}>SHARE</Text>
          </TouchableOpacity>

          {pins.length > 1 && (
            <View style={styles.dots} pointerEvents="none">
              {pins.map((pin, i) => (
                <View
                  key={pin.id}
                  style={[styles.dot, i === Math.min(index, pins.length - 1) && styles.dotOn]}
                />
              ))}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1, backgroundColor: color.surface },

  masthead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingBottom: space.md,
  },
  mastheadText: {
    fontFamily: font.semibold,
    fontSize: 12,
    letterSpacing: 2.2,
    color: color.navy,
  },
  mastheadSpacer: { width: 20 },

  // Centred rather than top-aligned, so the slack between the masthead and the
  // footer is split evenly above and below the photo-and-words block. A fixed
  // top margin would balance on one handset and pile up at the bottom of every
  // other one; this stays symmetric at any height.
  stage: { flex: 1, justifyContent: 'center' },

  card: {
    flex: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: color.surfaceSubtle,
  },
  photo: { width: '100%', height: '100%' },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.xl,
  },
  missingText: {
    fontFamily: font.regular,
    fontSize: 13,
    color: color.slateFaint,
    textAlign: 'center',
  },

  page: {
    paddingHorizontal: space.xl,
    marginTop: space.xxl,
  },
  dateLine: {
    fontFamily: font.semibold,
    fontSize: 10.5,
    letterSpacing: 1.7,
    color: color.slateFaint,
    marginBottom: space.sm,
  },
  headline: {
    // The serif, and the only place in the product it appears.
    fontFamily: font.memoryTitle,
    fontSize: 34,
    lineHeight: 42,
    letterSpacing: -0.3,
    color: color.navy,
  },
  headlineStop: {
    fontFamily: font.memoryTitle,
    fontSize: 34,
    color: color.yellow,
  },

  facts: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: space.md,
  },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  factDivider: {
    width: StyleSheet.hairlineWidth,
    height: 14,
    backgroundColor: color.hairline,
    marginHorizontal: space.md,
  },
  factText: {
    fontFamily: font.regular,
    fontSize: 13.5,
    color: color.slateFaint,
  },
  // Electric marks the place — the one fact here that is about somewhere the
  // dog found rather than a measurement of the walk.
  factPlace: { fontFamily: font.medium, color: color.electric },

  rule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.hairline,
    marginTop: space.lg,
  },

  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.lg,
  },
  noteBadge: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: color.yellowSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteText: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: 15,
    lineHeight: 22,
    color: color.navy,
  },
  noteHighlight: { fontFamily: font.semibold, color: color.electric },

  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.hairline,
    paddingTop: space.md,
    alignItems: 'center',
    gap: space.md,
  },
  action: { alignItems: 'center', gap: 4, paddingHorizontal: space.xxl },
  actionOff: { opacity: 0.55 },
  actionText: {
    fontFamily: font.semibold,
    fontSize: 10,
    letterSpacing: 1.4,
    color: color.navy,
  },
  actionTextOff: { color: color.slateFaint },

  dots: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: color.hairline,
  },
  dotOn: { backgroundColor: color.electric },
});
