/**
 * The pack's moments, as a reel.
 *
 * ── Why this is not the walk's photo viewer ────────────────────────────────
 *
 * A solo walk's keepsakes are a private archive: you page sideways through
 * your own pictures and the card tells you where and when. A Trail's moments
 * are something else — several people's photographs of one afternoon, in the
 * order the afternoon happened. Reading them sideways made them a folder.
 *
 * So this pages VERTICALLY, which is the gesture every person with a phone
 * already knows means "next, keep going", and it puts three things on the
 * photograph that the archive viewer has no reason to carry: whose it is, how
 * far into the walk it was taken, and a way to say you liked it.
 *
 * `KeepsakeViewer` stays exactly as it is for the solo walk. Two components
 * rather than one with a mode, because the difference is not a variant — the
 * axis, the chrome and the subject are all different, and a single component
 * doing both would be a pile of conditionals pretending to be shared code.
 *
 * ── What it deliberately does not do ───────────────────────────────────────
 *
 * There is no comment box. Hearts exist in the database
 * (`community_media_hearts`); replies do not, and inventing a text field with
 * nowhere to put the text would be worse than not offering one.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Polyline } from 'react-native-svg';

import { color, font, radius, space, type } from '../../constants/design';
import { haptic } from '../../lib/haptics';
import { DogAvatar } from './CommunityUI';
import type { CommunityDog } from '../../lib/communityWalks';

/** One moment, with everything the page needs already resolved. */
export interface ReelMoment {
  id: string;
  /** A signed URL. Null while one is being minted — the page says so. */
  uri: string | null;
  /** "12 MIN IN · 7:38 PM". Built by the caller; see momentDateline. */
  dateline: string;
  /** Whose photo it is, by first name or handle. */
  author: string;
  authorDogs: CommunityDog[];
  /** A note the contributor wrote, or what they were walking with. */
  detail: string | null;
  hearted: boolean;
  heartCount: number;
  /** 0…1, how far into the walk this was. See lib/community/reelTrace.ts. */
  progress: number;
  /** Only the contributor may take their own photo back out. */
  canRemove: boolean;
}

interface Props {
  moments: ReelMoment[];
  initialIndex: number;
  /** The walk's line, as an SVG points string. '' draws no trace. */
  tracePoints: string;
  traceWidth: number;
  traceHeight: number;
  onHeart: (id: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}

export function TrailReel({
  moments,
  initialIndex,
  tracePoints,
  traceWidth,
  traceHeight,
  onHeart,
  onRemove,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(initialIndex);
  const listRef = useRef<FlatList<ReelMoment>>(null);

  /**
   * Seeded on WHICH moments, never on the array's identity.
   *
   * The memory screen rebuilds this list every time it reloads — it re-mints
   * signed URLs into a fresh object — and seeding on identity meant every
   * reload threw the reader back to the photo they first tapped. Hearting one
   * reloads. That is what made the old viewer feel welded shut.
   */
  const momentKey = moments.map(moment => moment.id).join('|');
  const seededRef = useRef('');
  if (seededRef.current !== momentKey) {
    seededRef.current = momentKey;
  }

  const onSettled = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.y / height);
    setIndex(prev => (prev === next ? prev : next));
  }, [height]);

  const getItemLayout = useCallback(
    (_: unknown, i: number) => ({ length: height, offset: height * i, index: i }),
    [height],
  );

  const renderItem = useCallback(
    ({ item }: { item: ReelMoment }) => (
      <ReelPage
        moment={item}
        width={width}
        height={height}
        insets={{ top: insets.top, bottom: insets.bottom }}
        tracePoints={tracePoints}
        traceWidth={traceWidth}
        traceHeight={traceHeight}
        onHeart={onHeart}
        onRemove={onRemove}
      />
    ),
    [width, height, insets.top, insets.bottom, tracePoints, traceWidth, traceHeight, onHeart, onRemove],
  );

  if (!moments.length) return null;

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {/* Near-black rather than the app's navy: this is the one surface where
          a photograph is the subject, and any colour under it is a cast across
          every picture in the walk. */}
      <View style={styles.canvas}>
        <StatusBar style="light" />

        <FlatList
          ref={listRef}
          data={moments}
          keyExtractor={moment => moment.id}
          renderItem={renderItem}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          onMomentumScrollEnd={onSettled}
          getItemLayout={getItemLayout}
          initialScrollIndex={Math.min(Math.max(initialIndex, 0), moments.length - 1)}
          // Three pages resident — the one being read and its neighbours — so a
          // swipe never waits on a decode, and no more than that, because these
          // are full-screen bitmaps.
          windowSize={3}
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          removeClippedSubviews
        />

        {/* Segments, one per moment, along the top. The story convention, and
            the only place the reel says how many there are — a counter would
            turn an afternoon into a quantity. */}
        {moments.length > 1 ? (
          <View style={[styles.segments, { top: insets.top + 8 }]} pointerEvents="none">
            {moments.map((moment, i) => (
              <View
                key={moment.id}
                style={[styles.segment, i <= index && styles.segmentOn]}
              />
            ))}
          </View>
        ) : null}

        <Pressable
          onPress={onClose}
          style={[styles.close, { top: insets.top + 22 }]}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Ionicons name="chevron-back" size={22} color={color.surface} />
        </Pressable>

        {/* The one instruction, and only while there is somewhere to go. It
            fades out of a reader's attention after the first swipe because it
            only ever appears on the page they started on. */}
        {moments.length > 1 && index === 0 ? (
          <View style={[styles.hint, { bottom: insets.bottom + 128 }]} pointerEvents="none">
            <Ionicons name="chevron-up" size={15} color="rgba(255,255,255,0.55)" />
            <Text style={styles.hintText}>Swipe for the rest of the walk</Text>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function ReelPage({
  moment,
  width,
  height,
  insets,
  tracePoints,
  traceWidth,
  traceHeight,
  onHeart,
  onRemove,
}: {
  moment: ReelMoment;
  width: number;
  height: number;
  insets: { top: number; bottom: number };
  tracePoints: string;
  traceWidth: number;
  traceHeight: number;
  onHeart: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  /**
   * The lit portion of the trace.
   *
   * Drawn as a second polyline over the first, clipped by a width rather than
   * by splitting the path: splitting would need the route's own geometry to be
   * re-walked per page, and the fill is a progress bar that happens to be the
   * shape of a walk — not a claim about which metre the shutter fired at.
   */
  const litWidth = Math.max(0, Math.min(1, moment.progress)) * traceWidth;

  return (
    <View style={{ width, height }}>
      {moment.uri ? (
        <Image
          source={{ uri: moment.uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={160}
          // These are private-bucket URLs that expire. Memory-only keeps a
          // stale signature out of the disk cache, where it would outlive its
          // own validity and render as an empty frame.
          cachePolicy="memory"
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.missing]}>
          <Ionicons name="image-outline" size={30} color={color.slateFaint} />
          <Text style={styles.missingText}>This photo is still arriving</Text>
        </View>
      )}

      {/* Two washes rather than one over the whole frame: the middle of the
          picture is the part worth seeing, and a full-frame scrim dims exactly
          that. Gradients, not flat blocks — a solid wash ends in a hard line
          across the photo, which read as a dark band laid over it rather than
          as light falling off. They fade to clear well before the middle, and
          only as dark as the white text over them needs. */}
      <LinearGradient
        colors={WASH_TOP}
        style={[styles.washTop, { height: insets.top + 110 }]}
        pointerEvents="none"
      />
      <LinearGradient
        colors={WASH_BOTTOM}
        locations={[0, 0.45, 1]}
        style={[styles.washBottom, { height: 260 + insets.bottom }]}
        pointerEvents="none"
      />

      <View style={[styles.author, { top: insets.top + 26 }]} pointerEvents="none">
        {moment.authorDogs.length ? (
          <DogAvatar dog={moment.authorDogs[0]} size={30} />
        ) : (
          <View style={styles.authorBlank}>
            <Ionicons name="paw" size={14} color={color.navy} />
          </View>
        )}
        <View style={styles.authorCopy}>
          <Text style={styles.authorName} numberOfLines={1}>{moment.author}</Text>
          <Text style={styles.authorWhen} numberOfLines={1}>{moment.dateline}</Text>
        </View>
      </View>

      <View style={[styles.foot, { bottom: insets.bottom + space.lg }]}>
        {moment.detail ? (
          <Text style={styles.detail} numberOfLines={2}>{moment.detail}</Text>
        ) : null}

        {tracePoints ? (
          <View style={styles.traceCard}>
            <Text style={styles.traceLabel}>WHERE THE WALK HAD GOT TO</Text>
            <View style={{ width: traceWidth, height: traceHeight }}>
              <Svg width={traceWidth} height={traceHeight}>
                <Polyline
                  points={tracePoints}
                  fill="none"
                  stroke="rgba(255,255,255,0.3)"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
              <View style={[styles.traceLit, { width: litWidth }]}>
                <Svg width={traceWidth} height={traceHeight}>
                  <Polyline
                    points={tracePoints}
                    fill="none"
                    stroke={color.yellow}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
              </View>
            </View>
          </View>
        ) : null}

        <View style={styles.actions}>
          <Pressable
            onPress={() => { haptic.tap(); onHeart(moment.id); }}
            style={styles.action}
            accessibilityRole="button"
            accessibilityLabel={moment.hearted ? 'Remove your heart' : 'Heart this moment'}
          >
            <Ionicons
              name={moment.hearted ? 'heart' : 'heart-outline'}
              size={19}
              color={moment.hearted ? color.yellow : color.surface}
            />
            {moment.heartCount > 0 ? (
              <Text style={styles.actionCount}>{moment.heartCount}</Text>
            ) : null}
          </Pressable>

          {moment.canRemove ? (
            <Pressable
              onPress={() => onRemove(moment.id)}
              style={styles.action}
              accessibilityRole="button"
              accessibilityLabel="Take this photo off the walk"
            >
              <Ionicons name="trash-outline" size={18} color={color.surface} />
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/** Top to bottom. Clear at the far edge of each, so neither has a seam. */
const WASH_TOP = ['rgba(7,14,16,0.45)', 'rgba(7,14,16,0)'] as const;
const WASH_BOTTOM = ['rgba(7,14,16,0)', 'rgba(7,14,16,0.28)', 'rgba(7,14,16,0.62)'] as const;

/** Keeps white type legible on a bright patch without boxing it in. */
const TEXT_SHADOW = {
  textShadowColor: 'rgba(0,0,0,0.35)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 3,
} as const;

const styles = StyleSheet.create({
  canvas: { flex: 1, backgroundColor: '#0B0E10' },
  missing: { alignItems: 'center', justifyContent: 'center', gap: space.sm, backgroundColor: '#15191C' },
  missingText: { ...type.label, color: color.slateFaint },

  washTop: { position: 'absolute', top: 0, left: 0, right: 0 },
  washBottom: { position: 'absolute', bottom: 0, left: 0, right: 0 },

  segments: {
    position: 'absolute', left: space.lg, right: space.lg,
    flexDirection: 'row', gap: 4, zIndex: 8,
  },
  segment: { flex: 1, height: 2.5, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)' },
  segmentOn: { backgroundColor: color.surface },

  close: {
    position: 'absolute', left: space.lg, zIndex: 9,
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },

  author: {
    position: 'absolute', left: space.lg, right: space.lg,
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingLeft: 44,
  },
  authorBlank: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: color.yellow,
    alignItems: 'center', justifyContent: 'center',
  },
  authorCopy: { flex: 1, minWidth: 0 },
  authorName: { fontFamily: font.semibold, fontSize: 13, color: color.surface, ...TEXT_SHADOW },
  authorWhen: { fontFamily: font.medium, fontSize: 10.5, color: 'rgba(255,255,255,0.8)', letterSpacing: 0.4, ...TEXT_SHADOW },

  foot: { position: 'absolute', left: space.lg, right: space.lg, gap: space.sm },
  detail: { ...type.body, fontSize: 14, color: color.surface, ...TEXT_SHADOW },

  // No box of its own: it already sits on the bottom wash, and a second dark
  // panel over that is what stacked the foot of every photo to near-black.
  traceCard: { paddingVertical: 2, gap: 5 },
  traceLabel: {
    fontFamily: font.semibold, fontSize: 8.5, letterSpacing: 1.2,
    color: 'rgba(255,255,255,0.75)',
    ...TEXT_SHADOW,
  },
  // Clips the lit copy of the same line. `hidden` is what makes the fill grow
  // along the walk's own shape instead of as a straight bar.
  traceLit: { position: 'absolute', top: 0, left: 0, bottom: 0, overflow: 'hidden' },

  actions: { flexDirection: 'row', gap: space.sm },
  action: {
    minHeight: 40, minWidth: 52,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  actionCount: { fontFamily: font.semibold, fontSize: 12, color: color.surface },

  hint: {
    position: 'absolute', left: 0, right: 0,
    alignItems: 'center', gap: 1,
  },
  hintText: { fontFamily: font.medium, fontSize: 11, color: 'rgba(255,255,255,0.55)' },
});
