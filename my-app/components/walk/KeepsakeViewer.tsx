/**
 * KeepsakeViewer — a Walk Memory, given the whole screen.
 *
 * The map pin is a thumbnail on a street; this is the photograph, given room.
 *
 * ── What this replaced, and why (Sep 2026) ──
 * The first version was a white page with a peek carousel: a card at 79% of the
 * width, neighbours showing at the edges, each one scaled and faded live against
 * the scroll offset. Three things were wrong with it, and only the first was
 * visible.
 *
 * It stuttered. Every frame of every swipe re-rasterised a full-size image at a
 * new scale, while each slide ran an async resolution effect that called
 * setState mid-scroll, and settling fired a network lookup and a re-entry
 * animation. Scrolling did layout, JS and I/O at once.
 *
 * It re-announced text that had not changed. The caption block was keyed on the
 * photo id, so `FadeInDown` played on every settle — including for the headline,
 * which is derived from the pet's name and the part of the day and is therefore
 * IDENTICAL for every photo in one walk. An animation whose meaning is "this is
 * new" fired on a sentence that was not.
 *
 * And the photo was small. A memory rendered at 79% of a phone, with two dimmed
 * copies of other memories crowding it.
 *
 * ── What it is now ──
 * The photograph fills the screen. The sequence is carried at the top by story
 * segments — a language people already read — and the words sit in a card that
 * floats over the bottom.
 *
 * Full bleed, edge to edge, cropped rather than letterboxed. Tapping the photo
 * lowers the card until only its title shows, so the whole frame is visible;
 * tapping the photo or the card brings it back. That is the standard
 * photo-viewer gesture, and it is what makes the crop a trade rather than a
 * loss.
 *
 * The card is split into two halves that behave differently, and that split is
 * the whole design:
 *
 *   • CONSTANT — the dateline and the serif headline. They belong to the WALK,
 *     not to the photo, so they hold still while you page. Keyed on the headline
 *     text rather than the photo id, so they re-enter if and only if the words
 *     actually change (a viewer spanning two days would; one walk never does).
 *
 *   • CHANGING — the route rail, the elapsed and distance line, the place and
 *     weather, the note. These are the facts that differ photo to photo, and
 *     they are the only thing that animates.
 *
 * ── The route rail ──
 * Seven dots across the walk's duration with this one filled says "right at the
 * start" or "near the end" in one glance, without a sentence — which matters
 * because the caption engine cannot write a different sentence per photo and
 * should not pretend to (lib/walk/keepsakeCaption.ts). It doubles as the
 * navigation the peek carousel used to provide: tap a dot to jump.
 *
 * ── Degradation ──
 * Resolution runs the usual ladder. When no image can be produced the page still
 * holds its place in the sequence and still carries its words — the time and
 * place are real facts about a real moment, so a lost photo leaves a page rather
 * than a gap in the film. Sharing is the one thing that genuinely needs the
 * original, so it is disabled rather than failing when there isn't one.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import * as Sharing from 'expo-sharing';
import Reanimated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { color, font, radius, space } from '../../constants/design';
import { haptic } from '../../lib/haptics';
import { useKeepsakeImage } from '../../hooks/useKeepsakeImage';
import { usePlaceVisitCount } from '../../hooks/usePlaceVisitCount';
import {
  buildKeepsakeCaption,
  type KeepsakeCaption as Caption,
  type KeepsakeFact,
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
  /**
   * How long the whole walk ran, in seconds.
   *
   * Optional, and the rail is honest either way: given it, the dots sit on the
   * real duration and the page can say "of 58 min". Without it the rail spans
   * the photographed stretch instead and the total is simply not claimed — a
   * last photo pinned to the end of a walk that carried on for another twenty
   * minutes would be a small lie told confidently.
   */
  durationS?: number | null;
}

interface Props {
  /** The moments to page through, in the order they happened. */
  pins: KeepsakeMapPin[] | null;
  /** Which one the tap was on. */
  initialIndex?: number;
  /** Everything needed to caption the photo. Absent means image only. */
  context?: KeepsakeWalkContext;
  onClose: () => void;
}

/**
 * One page — edge to edge, corner to corner.
 *
 * `cover`, not `contain`. Letterboxing was the first build's answer and it was
 * the cautious one: it guaranteed no crop, and it bought that with black bands
 * down both sides of every portrait photo, on a screen whose entire job is to
 * make a photograph feel like something worth keeping. Bands read as a file
 * preview. Full bleed reads as a picture.
 *
 * What cover costs is the part of the frame hidden behind the card, which is
 * why tapping the photo slides the card down — see `peeked` below. Nothing is
 * unreachable, it is just not all on screen at once.
 */
function KeepsakePage({
  pin,
  width,
  height,
  onPress,
}: {
  pin: KeepsakeMapPin;
  width: number;
  height: number;
  onPress: () => void;
}) {
  const resolved = useKeepsakeImage(pin.uri ? null : pin.keepsake ?? null, {
    allowLocalOriginal: true,
  });
  const uri = pin.uri ?? resolved.uri;

  return (
    <Pressable style={{ width, height }} onPress={onPress} accessibilityRole="imagebutton">
      {uri ? (
        <Image
          source={{ uri }}
          style={styles.photo}
          contentFit="cover"
          // Short, and only on first paint of a page. The old 220ms crossfade
          // fired while the carousel was still moving, which is where a lot of
          // the perceived stutter came from.
          transition={160}
          cachePolicy="memory-disk"
        />
      ) : (
        <View style={styles.missing}>
          <MaterialIcons name="image-not-supported" size={26} color={color.creamFaint} />
          <Text style={styles.missingText}>No longer on this device</Text>
        </View>
      )}
    </Pressable>
  );
}

/**
 * Where each photo sits along the walk.
 *
 * Positions come from `elapsedS`, falling back to an even spread when a photo
 * has no elapsed time — an old keepsake written before the field existed still
 * belongs somewhere in the sequence, and dropping it from the rail would make
 * the dots disagree with the segments above.
 */
function useRailPositions(
  pins: readonly KeepsakeMapPin[],
  durationS: number | null | undefined,
): number[] | null {
  return useMemo(() => {
    const elapsed = pins.map(p => p.keepsake?.elapsedS ?? null);
    const known = elapsed.filter((v): v is number => v != null && Number.isFinite(v) && v >= 0);
    if (known.length === 0) return null;

    const span =
      durationS != null && Number.isFinite(durationS) && durationS > 0
        ? durationS
        : Math.max(...known);
    if (span <= 0) return null;

    return elapsed.map((value, i) =>
      value == null || !Number.isFinite(value)
        ? pins.length === 1
          ? 0
          : i / (pins.length - 1)
        : Math.min(1, Math.max(0, value / span)),
    );
  }, [pins, durationS]);
}

function RouteRail({
  positions,
  index,
  onJump,
}: {
  positions: number[];
  index: number;
  onJump: (i: number) => void;
}) {
  const here = positions[index] ?? 0;
  return (
    <View style={styles.rail}>
      <View style={styles.railTrack} />
      <View style={[styles.railWalked, { width: `${here * 100}%` }]} />
      {positions.map((position, i) => (
        <TouchableOpacity
          key={i}
          // Centred on the position rather than laid out by it: the dots are a
          // measurement, not a row, and two photos a minute apart must sit a
          // minute apart.
          style={[styles.railHit, { left: `${position * 100}%` }]}
          onPress={() => onJump(i)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Moment ${i + 1} of ${positions.length}`}
        >
          <View style={[styles.railDot, i === index && styles.railDotHere]} />
        </TouchableOpacity>
      ))}
    </View>
  );
}

/**
 * The stat row's columns — value on top, what it means underneath.
 *
 * The caption engine writes phrases ("2 minutes in", "59 m in", "Near Arpora")
 * because they were built to sit in a sentence-like row. A divided three-up
 * needs the opposite shape: the number alone, big, with its unit of meaning
 * demoted to a label. So the phrase is split here rather than re-worded in the
 * engine, which stays the single source of what a moment is allowed to claim.
 */
interface StatColumn {
  value: string;
  label: string;
  accent?: boolean;
}

function statColumns(facts: KeepsakeFact[], note: Caption['note']): StatColumn[] {
  const columns: StatColumn[] = [];

  const elapsed = facts.find(f => f.kind === 'elapsed');
  if (elapsed) {
    // "12 minutes in" → "12 min"; "Right at the start" has no number to lift, so
    // it keeps its words and takes the label slot instead.
    const match = /^(\d+)\s+minutes?\s+in$/.exec(elapsed.text);
    columns.push(
      match
        ? { value: `${match[1]} min`, label: 'into the walk' }
        : { value: 'The start', label: 'of the walk' },
    );
  }

  const distance = facts.find(f => f.kind === 'distance');
  if (distance) {
    // "0.9 km in" / "59 m in" → value "0.9 km", label "walked".
    columns.push({ value: distance.text.replace(/\s+in$/, ''), label: 'walked' });
  }

  /**
   * The note, as the third column.
   *
   * It used to be a row of its own at the foot of the card — a paw badge and a
   * sentence, about seventy points of the card's height for one fact, on a
   * screen whose subject is the photograph behind it. As a column it says the
   * same thing in the space that was already there.
   *
   * The engine's `kind` is what makes this safe. Both notes arrive as one
   * phrase ("23 times", "Three weeks ago") and each needs splitting differently;
   * guessing which by looking at the words would break the first time the copy
   * was edited.
   */
  if (note?.kind === 'visits') {
    columns.push({ value: note.highlight.replace(/\s+times$/, ''), label: 'times here' });
  } else if (note?.kind === 'ago') {
    columns.push({ value: note.highlight.replace(/\s+ago$/, ''), label: 'ago' });
  }

  return columns;
}

/** "Arpora" — the place, without the preposition the sentence form needs. */
function placeName(facts: KeepsakeFact[]): string | null {
  const place = facts.find(f => f.kind === 'place');
  return place ? place.text.replace(/^Near\s+/, '') : null;
}

/** "5 SEPTEMBER" — the date, with the weekday left to the headline. */
function dateLabel(capturedAt: number): string {
  return new Date(capturedAt)
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
    .toUpperCase();
}

/**
 * The half of the page that changes.
 *
 * Its own component because the place-visit count is an async lookup keyed on
 * whichever photo is showing — running that hook in the parent would refetch on
 * every scroll frame rather than once per settled photo.
 */
function ChangingFacts({
  pin,
  caption,
  positions,
  index,
  durationLabel,
  onJump,
}: {
  pin: KeepsakeMapPin;
  caption: Caption;
  positions: number[] | null;
  index: number;
  durationLabel: string | null;
  onJump: (i: number) => void;
}) {
  const columns = statColumns(caption.facts, caption.note);
  const weather = caption.facts.find(f => f.kind === 'weather');

  /**
   * The weather, alone, under the title — and only when there is any.
   *
   * The time moved up into the dateline and the place with it, which left this
   * line holding one optional fact. It stays a line rather than becoming a
   * fourth column because weather belongs to the WALK, not to this photo: it is
   * the same value on every page, and a column that never changes while its
   * neighbours do reads as broken.
   *
   * No paging jerk from its coming and going, for the same reason — it is
   * constant across a walk, so its height is decided once when the card opens.
   */
  const subtitle = weather?.text ?? null;

  /**
   * No key, and no entering animation.
   *
   * This block used to be keyed on the photo id, which meant every swipe
   * unmounted it and faded a fresh copy in from zero — so the rail and the
   * numbers blinked out and back while sitting in exactly the same place. A
   * cross-fade needs two things in the same frame; this was a fade-in with
   * nothing fading out, which is a flash.
   *
   * Updating the text in place is both steadier and more honest: the card is
   * not a new card, it is the same card now describing a different photo.
   */
  return (
    <View>
      {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}

      {positions && positions.length > 1 && (
        <RouteRail positions={positions} index={index} onJump={onJump} />
      )}

      {columns.length > 0 && (
        <View style={styles.stats}>
          {columns.map((column, i) => (
            <React.Fragment key={column.label}>
              {i > 0 && <View style={styles.statDivider} />}
              <View style={styles.stat}>
                <Text
                  style={[styles.statValue, column.accent && styles.statValueAccent]}
                  numberOfLines={1}
                >
                  {column.value}
                </Text>
                <Text style={styles.statLabel} numberOfLines={1}>
                  {i === 0 && durationLabel ? durationLabel : column.label}
                </Text>
              </View>
            </React.Fragment>
          ))}
        </View>
      )}

    </View>
  );
}

/** "9:15 pm" — the clock time, in whatever form the device writes it. */
function timeOfDayLabel(capturedAt: number): string {
  return new Date(capturedAt).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function KeepsakeViewer({ pins, initialIndex = 0, context, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();

  const [index, setIndex] = useState(initialIndex);
  const listRef = useRef<FlatList<KeepsakeMapPin>>(null);

  /**
   * Enter at the tapped photo — every time, not just the first.
   *
   * Both call sites keep this component mounted and swap `pins` between null
   * and a walk's moments, so `initialScrollIndex` (which FlatList reads once)
   * would be honoured for the first pin anyone opened and silently ignored for
   * every one after it. That is the same trap the previous version documented
   * and solved with an effect; the layout changed, the trap did not.
   *
   * The width is read through a ref so rotating the phone does not count as an
   * open and throw the reader back to the photo they started on.
   */
  const widthRef = useRef(width);
  widthRef.current = width;
  useEffect(() => {
    if (!pins || pins.length === 0) return;
    const next = Math.min(Math.max(initialIndex, 0), pins.length - 1);
    setIndex(next);
    setPeeked(false);
    listRef.current?.scrollToOffset({ offset: next * widthRef.current, animated: false });
  }, [pins, initialIndex]);

  /**
   * The card, out of the way — but never gone.
   *
   * The counterweight to full bleed: the card covers the lower third, so there
   * has to be a way to see what is under it. One tap on the photo, the way every
   * photo viewer on the phone already works.
   *
   * It SLIDES rather than disappears. The first build faded the whole card out,
   * and a bottom sheet that vanishes on a tap outside it reads as a dismissal —
   * as though something was cancelled. Sliding down to leave the title showing
   * says the opposite: the words are still there, you are just looking at the
   * picture. It also leaves an obvious way back, which a faded-out card does not.
   *
   * Resets on every open. Coming back to a walk to find the words tucked away
   * would read as a bug, and the words are half of what this screen is for.
   */
  const [peeked, setPeeked] = useState(false);
  const togglePeek = useCallback(() => {
    haptic.tap();
    setPeeked(prev => !prev);
  }, []);

  /**
   * How far down the card travels: its own height, less whatever the title
   * block occupies and a margin under it.
   *
   * Both numbers are measured rather than assumed. The card's height depends on
   * its content (a moment with no weather line is shorter) and the title block's
   * on how many lines the headline takes — a long pet name wraps to two. A
   * constant here would peek at the right place on one phone and cut the title
   * in half on another.
   */
  const [cardHeight, setCardHeight] = useState(0);
  const [titleBottom, setTitleBottom] = useState(0);
  const onCardLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.height);
    setCardHeight(prev => (Math.abs(prev - next) < 2 ? prev : next));
  }, []);
  const onTitleLayout = useCallback((event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    const next = Math.round(y + height);
    setTitleBottom(prev => (Math.abs(prev - next) < 2 ? prev : next));
  }, []);

  const peekOffset =
    cardHeight > 0 && titleBottom > 0
      ? Math.max(0, cardHeight - titleBottom - space.xl)
      : 0;

  const slide = useSharedValue(0);
  useEffect(() => {
    const target = peeked ? peekOffset : 0;
    slide.value = reduced
      ? target
      : // Eased out, not sprung. A sheet carrying a photograph's caption should
        // arrive and stop; a bounce would draw attention to the motion, which is
        // the one thing this screen is not about.
        withTiming(target, { duration: 340, easing: Easing.out(Easing.cubic) });
  }, [peeked, peekOffset, reduced, slide]);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: slide.value }],
  }));

  const list = pins ?? [];
  const current = list[Math.min(index, Math.max(0, list.length - 1))];
  const positions = useRailPositions(list, context?.durationS);

  const priorVisits = usePlaceVisitCount(context?.petId ?? null, current?.keepsake ?? null);

  const caption = useMemo<Caption | null>(() => {
    const keepsake = current?.keepsake ?? null;
    const capturedAt = keepsake?.capturedAt ?? null;
    if (capturedAt == null) return null;

    // How far they had walked by the time of the photo. The route index is
    // already the nearest vertex, so the cumulative curve answers it directly.
    const route = context?.route ?? [];
    const routeIndex = keepsake?.routeIndex ?? null;
    const distanceM =
      routeIndex != null && route.length >= 2
        ? cumulativeDistances(route)[Math.min(routeIndex, route.length - 1)] ?? null
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
  }, [current, context, priorVisits]);

  /**
   * The three coordinates of the moment, for the dateline.
   *
   * Built here rather than in `ChangingFacts` because the row sits above the
   * headline — but the clock time is per-photo, so this block updates in place
   * as pages settle. Only the `key` on the headline decides whether the entry
   * animation replays, and that still only changes between walks.
   */
  const capturedAt = current?.keepsake?.capturedAt ?? null;
  const eyebrowDate = capturedAt != null ? dateLabel(capturedAt) : null;
  const eyebrowTime = capturedAt != null ? timeOfDayLabel(capturedAt).toUpperCase() : null;
  const eyebrowPlace = caption ? placeName(caption.facts)?.toUpperCase() ?? null : null;

  const durationLabel = useMemo(() => {
    const seconds = context?.durationS;
    if (seconds == null || !Number.isFinite(seconds) || seconds < 60) return null;
    return `of ${Math.round(seconds / 60)} min`;
  }, [context?.durationS]);

  // Sharing needs a real file, which only the top rung of the ladder has. A
  // thumbnail is a stand-in for rendering, not something to hand to Instagram.
  const shareable = useKeepsakeImage(current?.uri ? null : current?.keepsake ?? null, {
    allowLocalOriginal: true,
  });
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

  const onSettled = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(event.nativeEvent.contentOffset.x / width);
      setIndex(prev => (prev === next ? prev : next));
    },
    [width],
  );

  const jumpTo = useCallback(
    (i: number) => {
      haptic.tap();
      setIndex(i);
      listRef.current?.scrollToOffset({ offset: i * width, animated: true });
    },
    [width],
  );

  const renderItem = useCallback(
    ({ item }: { item: KeepsakeMapPin }) => (
      <KeepsakePage pin={item} width={width} height={height} onPress={togglePeek} />
    ),
    [width, height, togglePeek],
  );

  const getItemLayout = useCallback(
    (_: unknown, i: number) => ({ length: width, offset: width * i, index: i }),
    [width],
  );

  if (!pins || pins.length === 0) return null;

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {/* The ground is near-black rather than the app's navy: this is the one
          surface where a photograph is the subject, and any colour under it is
          a colour cast across every picture in the archive. */}
      <View style={styles.canvas}>
        <StatusBar style="light" />

        <FlatList
          ref={listRef}
          data={pins}
          keyExtractor={pin => pin.id}
          renderItem={renderItem}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onSettled}
          getItemLayout={getItemLayout}
          initialScrollIndex={Math.min(initialIndex, pins.length - 1)}
          // Three pages resident: the one being read and its two neighbours, so
          // a swipe never waits on a decode. Anything wider holds full-screen
          // bitmaps for photos nobody is looking at.
          windowSize={3}
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          removeClippedSubviews
        />

        {pins.length > 1 && !peeked && (
          <Reanimated.View
            entering={reduced ? undefined : FadeIn.duration(200)}
            exiting={reduced ? undefined : FadeOut.duration(160)}
            style={[styles.segments, { top: insets.top + 8 }]}
            pointerEvents="none"
          >
            {pins.map((pin, i) => (
              <View
                key={pin.id}
                style={[styles.segment, i === index && styles.segmentOn]}
              />
            ))}
          </Reanimated.View>
        )}

        {/* Back stays while the card is peeked; share does not.
            Removing the only way out of a full-screen modal to reveal more of a
            picture is the trade nobody wants — every other control is optional,
            that one is the exit. */}
        <View style={[styles.chrome, { top: insets.top + (pins.length > 1 ? 24 : 8) }]}>
          <TouchableOpacity
            style={styles.chromeButton}
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <MaterialIcons name="arrow-back-ios-new" size={18} color={color.cream} />
          </TouchableOpacity>

          {!peeked && (
            <Reanimated.View
              entering={reduced ? undefined : FadeIn.duration(200)}
              exiting={reduced ? undefined : FadeOut.duration(160)}
            >
              <TouchableOpacity
                style={[styles.chromeButton, !shareUri && styles.chromeButtonOff]}
                onPress={onShare}
                disabled={!shareUri}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Share this moment"
              >
                <MaterialIcons
                  name="ios-share"
                  size={18}
                  color={shareUri ? color.cream : color.creamFaint}
                />
              </TouchableOpacity>
            </Reanimated.View>
          )}
        </View>

        {!!caption && (
          <Reanimated.View
            onLayout={onCardLayout}
            entering={reduced ? undefined : FadeIn.duration(220)}
            style={[
              styles.card,
              // Enough clearance that the card's own bottom edge is off-screen
              // once it has travelled: a rounded corner floating mid-photo is
              // the tell that a sheet is "hidden" rather than lowered.
              { paddingBottom: insets.bottom + space.lg },
              cardStyle,
            ]}
          >
            {/* Tapping the peeked card brings it back — the sheet itself is the
                way back into the words, so the affordance is the whole surface
                rather than the 34pt grabber. A tap while it is open does
                nothing on purpose: it must not collapse under someone who was
                reaching for the text, and swallowing the tap here is what stops
                it reaching the photo underneath. */}
            <Pressable
              onPress={() => {
                if (peeked) togglePeek();
              }}
              accessibilityRole={peeked ? 'button' : undefined}
              accessibilityLabel={peeked ? 'Show the details for this moment' : undefined}
            >
              <View style={styles.grabber} />

              {/* ── The constant half ──
                  Keyed on the words themselves. One walk yields one headline for
                  every photo in it, so this mounts once and then holds still
                  while the pages move under it.

                  Measured, too: what is left showing when the card is down is
                  exactly this block. */}
              <Reanimated.View
                key={caption.headline}
                onLayout={onTitleLayout}
                entering={reduced ? undefined : FadeInDown.duration(360)}
              >
              {/* ── The dateline, doing three jobs ──
                  Date, clock time and place on one row. Each was a line of its
                  own before — the date here, the time in a subtitle, the place
                  as a stat column — and none of them needed one: they are the
                  three coordinates of a moment and they read as a set.

                  The weekday is gone, not lost. "Bruno, Saturday evening" is
                  directly underneath, so "SATURDAY, 5 SEPTEMBER" was saying it
                  twice in two typefaces — and dropping it is what makes room
                  for the other two facts on the same line.

                  The place keeps its electric blue: the one thing on this card
                  the dog found rather than something the walk measured. */}
              <Text
                style={styles.dateLine}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.85}
              >
                {eyebrowDate}
                {!!eyebrowTime && ` · ${eyebrowTime}`}
                {!!eyebrowPlace && (
                  <Text style={styles.dateLinePlace}>{` · ${eyebrowPlace}`}</Text>
                )}
              </Text>
              <Text style={styles.headline} numberOfLines={2}>
                {caption.headline}
                {/* The one spot of brand colour in the type — a full stop that
                    says this is a Pawtchi page without a logo having to. */}
                <Text style={styles.headlineStop}>.</Text>
              </Text>
              </Reanimated.View>

              {!!current && (
                <ChangingFacts
                  pin={current}
                  caption={caption}
                  positions={positions}
                  index={index}
                  durationLabel={durationLabel}
                  onJump={jumpTo}
                />
              )}
            </Pressable>
          </Reanimated.View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1, backgroundColor: '#0B0F14' },

  photo: { flex: 1 },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.xxl,
  },
  missingText: {
    fontFamily: font.memoryRegular,
    fontSize: 13,
    color: color.creamFaint,
    textAlign: 'center',
  },

  // ── Top chrome ──
  segments: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    flexDirection: 'row',
    gap: 4,
  },
  segment: {
    flex: 1,
    height: 2.5,
    borderRadius: 2,
    backgroundColor: 'rgba(244, 241, 236, 0.35)',
  },
  segmentOn: { backgroundColor: color.cream },

  chrome: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  chromeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    // A disc rather than a bare glyph: the photo behind is arbitrary, and a
    // white icon on a white sky is not a control anyone can find.
    backgroundColor: 'rgba(7, 32, 42, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chromeButtonOff: { backgroundColor: 'rgba(7, 32, 42, 0.28)' },

  // ── The card ──
  card: {
    position: 'absolute',
    left: space.sm,
    right: space.sm,
    bottom: space.sm,
    backgroundColor: color.surface,
    borderRadius: radius.xxl,
    // 20 inside the card's own 8 from the screen edge — 28 of margin against
    // the phone, which is the air a listing page leaves around its title and
    // the reason that type reads as calm rather than merely large.
    paddingHorizontal: space.xl,
    paddingTop: space.md,
  },
  grabber: {
    alignSelf: 'center',
    width: 34,
    height: 4,
    borderRadius: 2,
    backgroundColor: color.hairline,
    marginBottom: space.md,
  },
  /**
   * ── The title block ──
   *
   * Centred, and set to the proportions of a listing header: an eyebrow, a
   * title that is much bigger than everything near it, and one muted line of
   * context under it. Airbnb's whole typographic trick is that the title has no
   * competition — the next largest thing on their page is less than two-thirds
   * its size — so the eye lands once and then reads downward. The old card put
   * a 13pt semibold measure line directly under the headline and lost that.
   */
  dateLine: {
    fontFamily: font.memorySemibold,
    fontSize: 10.5,
    letterSpacing: 1.7,
    color: color.slateFaint,
    textAlign: 'center',
  },
  dateLinePlace: {
    fontFamily: font.memorySemibold,
    color: color.electric,
  },
  /**
   * The title, and the reason this screen has its own face.
   *
   * Bold, big, and tracked in. A listing title works by having no competition
   * and by being set tight enough that two lines read as one object — which is
   * a property of the letterforms as much as the leading: Plus Jakarta's
   * narrower bowls hold at -0.5 where Montserrat would look cramped.
   *
   * This replaced the Playfair serif on request, to match the reference. The
   * serif's argument is in constants/design.ts if it is ever worth revisiting.
   */
  headline: {
    fontFamily: font.memoryBold,
    fontSize: 28,
    // 1.17 — the tight leading a two-line display title needs. At the old 35 on
    // 29 the two lines drifted apart and read as two sentences.
    lineHeight: 33,
    letterSpacing: -0.5,
    color: color.ink,
    textAlign: 'center',
    marginTop: space.sm,
  },
  headlineStop: {
    fontFamily: font.memoryBold,
    fontSize: 28,
    color: color.yellow,
  },
  subtitle: {
    fontFamily: font.memoryRegular,
    fontSize: 14.5,
    lineHeight: 20,
    color: color.slateMuted,
    textAlign: 'center',
    marginTop: space.sm,
  },

  // ── The rail ──
  rail: {
    height: 16,
    justifyContent: 'center',
    marginTop: space.lg,
    // Half a dot at each end, so the first and last markers sit inside the card
    // rather than half over its padding.
    marginHorizontal: 6,
  },
  railTrack: {
    height: 1.5,
    borderRadius: 1,
    backgroundColor: color.hairline,
  },
  railWalked: {
    position: 'absolute',
    left: 0,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: color.navy,
  },
  railHit: {
    position: 'absolute',
    width: 22,
    height: 22,
    marginLeft: -11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  railDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: color.slateFaint,
  },
  railDotHere: {
    width: 13,
    height: 13,
    borderRadius: 7,
    backgroundColor: color.yellow,
    borderWidth: 2,
    borderColor: color.navy,
  },

  /**
   * ── The stat row ──
   *
   * The shape Airbnb uses for `5.0 ★ | Guest favourite | 5 reviews`, and it
   * works for the same reason: three facts, equal width, hairline-separated,
   * value above meaning. Pills said the same things and said them as chrome —
   * a rounded fill around a fact makes it look like a filter you could tap off.
   *
   * No border of its own. The note's top rule below is the divider, exactly as
   * the rule above "Hosted by" is on a listing, so a moment with nothing to note
   * simply ends here rather than trailing a line under itself.
   */
  stats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space.xl,
  },
  stat: { flex: 1, alignItems: 'center' },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    height: 34,
    backgroundColor: color.hairline,
    marginHorizontal: space.sm,
  },
  statValue: {
    fontFamily: font.memoryBold,
    fontSize: 17,
    letterSpacing: -0.2,
    color: color.ink,
  },
  // Electric marks the place — the one fact here that is about somewhere the
  // dog found rather than a measurement of the walk.
  statValueAccent: { color: color.electric },
  statLabel: {
    fontFamily: font.memoryRegular,
    fontSize: 11.5,
    color: color.slateFaint,
    marginTop: 3,
  },

});
