/**
 * MomentCard — "Two lines, one walk" (locked direction, 2026-07-10).
 *
 * The walk drawn twice on a light ground: the human's path as a steady ink
 * line, the dog's path as a Pawtchi-yellow line that weaves around it, loops
 * at every real sniff stop, and ends in a paw print. Loop count and position
 * come straight from the session's pause events — the playfulness is data,
 * never decoration — and the weave is seeded by the session id, so a shared
 * card renders identically forever.
 *
 * Three grounds:
 *   map (default) — washed, label-quiet basemap of the real area. The camera
 *                   is bounds-fit with the same insets the SVG projection
 *                   uses, so the drawn lines sit on their real streets.
 *   paper         — plain warm white.
 *   photo         — the owner's photo; the lockup flips to white over a flat
 *                   scrim band.
 *
 * Geometry and copy come from lib/momentCard.ts; capture/share lives in
 * lib/shareMoment.ts. This component only arranges pixels.
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import { color, font, radius } from '../constants/design';
import { PawtchiWordmark } from './PawtchiWordmark';
import {
  buildCompanionPath,
  buildMomentHeadline,
  buildMomentStats,
  buildOwnerPath,
  momentDateLine,
  MomentRoutePoint,
  MomentStats,
} from '../lib/momentCard';
import { OSM_ATTRIBUTION, OSM_STYLE } from '../lib/walk/osmStyle';
import type { WalkLabels } from '../lib/walk/geoLabels';

export type MomentGround = 'map' | 'paper' | 'photo';

export interface MomentCardProps {
  petName: string;
  petGender?: string | null;
  startedAt: number;
  route: MomentRoutePoint[];
  pausePoints: MomentRoutePoint[];
  labels: WalkLabels;
  stats: MomentStats;
  /** Seeds the companion weave — the walk session id. */
  sessionId: string;
  ground?: MomentGround;
  photoUri?: string | null;
  /** Sniff-loop captions, keyed by loop index ("the corgi"). */
  loopCaptions?: Record<number, string>;
  /** When set, loops become tap targets (the preview's caption editor). */
  onLoopPress?: (index: number) => void;
  /** Card width in dp; height follows the 9:16 story ratio. */
  width?: number;
}

const ink = color.moment;

// Soft dark halo behind every text element on the photo ground — the scrims
// carry most of the legibility, this holds the letters over busy mid-frame
// areas (fences, foliage) the gradients don't reach. Photo ground only; the
// paper/map grounds are ink-on-paper and stay flat.
const PHOTO_TEXT_SHADOW = {
  textShadowColor: 'rgba(8, 10, 12, 0.65)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 5,
} as const;

// Card geometry (all derived from width so capture scale is free).
const CARD_PAD = 18;
const HEADER_H = 56;
const LOCKUP_H = 118;
const ROUTE_PAD = 14;

// MapLibre is a native module — absent in Expo Go. Fall back to paper.
let MapLibre: { MapView: any; Camera: any } | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@maplibre/maplibre-react-native');
  MapLibre = { MapView: mod.MapView, Camera: mod.Camera };
} catch {
  MapLibre = null;
}

/** Washed basemap of the walk's real area, camera-fit to the same insets the
 *  SVG projection uses so streets align with the drawn lines. */
function MapGround({ route, cardH }: { route: MomentRoutePoint[]; cardH: number }) {
  const bounds = useMemo(() => {
    if (route.length < 2 || !MapLibre) return null;
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const p of route) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    }
    return {
      ne: [maxLng, maxLat] as [number, number],
      sw: [minLng, minLat] as [number, number],
      paddingLeft: CARD_PAD + ROUTE_PAD,
      paddingRight: CARD_PAD + ROUTE_PAD,
      paddingTop: HEADER_H + ROUTE_PAD,
      paddingBottom: LOCKUP_H + ROUTE_PAD,
    };
  }, [route]);

  if (!MapLibre || !bounds) return null;
  const { MapView, Camera } = MapLibre;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <MapView
        style={StyleSheet.absoluteFill}
        mapStyle={OSM_STYLE as unknown as object}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        pitchEnabled={false}
        rotateEnabled={false}
        scrollEnabled={false}
        zoomEnabled={false}
      >
        <Camera bounds={bounds} animationDuration={0} />
      </MapView>
      {/* The wash: quiets the raster to a ghost so the two lines own the card. */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: ink.paperWash }]} />
      <Text style={[styles.osmCredit, { top: cardH - LOCKUP_H - 14 }]}>{OSM_ATTRIBUTION}</Text>
    </View>
  );
}

/** Paw print — four toes and a pad, one glyph, drawn not fonted. */
function PawMark({ x, y, onPhoto, fill = ink.yellow }: { x: number; y: number; onPhoto: boolean; fill?: string }) {
  const stroke = onPhoto ? 'rgba(20,18,14,0.35)' : ink.ink;
  return (
    <G transform={`translate(${x},${y})`}>
      <Circle cx={-4.6} cy={-2.6} r={1.8} fill={fill} stroke={stroke} strokeWidth={0.7} />
      <Circle cx={-1.5} cy={-4.6} r={1.8} fill={fill} stroke={stroke} strokeWidth={0.7} />
      <Circle cx={1.9} cy={-4.4} r={1.8} fill={fill} stroke={stroke} strokeWidth={0.7} />
      <Circle cx={5} cy={-2.2} r={1.8} fill={fill} stroke={stroke} strokeWidth={0.7} />
      <Path
        d="M0,-0.6 C2.6,-0.6 4.2,1.4 4.2,3.2 C4.2,5.2 2.2,6.4 0,6.4 C-2.2,6.4 -4.2,5.2 -4.2,3.2 C-4.2,1.4 -2.6,-0.6 0,-0.6 Z"
        fill={fill}
        stroke={stroke}
        strokeWidth={0.7}
      />
    </G>
  );
}

export function MomentCard({
  petName,
  petGender,
  startedAt,
  route,
  pausePoints,
  labels,
  stats,
  sessionId,
  ground = 'map',
  photoUri,
  loopCaptions,
  onLoopPress,
  width = 320,
}: MomentCardProps) {
  const height = Math.round((width * 16) / 9);
  const onPhoto = ground === 'photo' && Boolean(photoUri);

  const zoneW = width - CARD_PAD * 2;
  const zoneH = height - HEADER_H - LOCKUP_H;

  const ownerPath = useMemo(
    () => buildOwnerPath(route, zoneW, zoneH, ROUTE_PAD),
    [route, zoneW, zoneH],
  );
  const companion = useMemo(
    () => buildCompanionPath(route, pausePoints, zoneW, zoneH, ROUTE_PAD, sessionId),
    [route, pausePoints, zoneW, zoneH, sessionId],
  );

  // Photo ground draws the walk as a single slim ribbon in an upper band, so
  // it never lands on the subject. Same seeded, data-true weave — just
  // projected into its own box, so the ribbon shape stays unique per walk.
  const photoRouteTop = Math.round(height * 0.30);
  const photoRouteH = Math.round(height * 0.22);
  const photoYellow = ink.yellowOnPhoto;
  const photoCompanion = useMemo(
    () => buildCompanionPath(route, pausePoints, zoneW, photoRouteH, ROUTE_PAD, sessionId),
    [route, pausePoints, zoneW, photoRouteH, sessionId],
  );

  const sniffCount = pausePoints.length;
  const headline = useMemo(
    () => buildMomentHeadline(petName, petGender, sniffCount, stats.durationS).toUpperCase(),
    [petName, petGender, sniffCount, stats.durationS],
  );
  const statBlocks = useMemo(() => buildMomentStats(stats, sniffCount), [stats, sniffCount]);
  const dateLine = useMemo(() => momentDateLine(startedAt).toUpperCase(), [startedAt]);
  const placeLabel = labels.startLabel ?? (labels.isLoop ? labels.farthestLabel : labels.endLabel);

  const ownerStroke = onPhoto ? ink.onPhoto : ink.ink;
  const captionColor = onPhoto ? ink.onPhotoSoft : ink.inkFaint;
  const headlineColor = onPhoto ? ink.onPhotoSoft : ink.inkSoft;
  const numberColor = onPhoto ? ink.onPhoto : ink.ink;
  const unitColor = onPhoto ? ink.onPhotoFaint : ink.inkFaint;

  // ── Photo ground — the branded story card ──────────────────────────────────
  // Full-bleed owner photo, legibility scrims top and bottom, a location + date
  // lockup up top, the dynamic route ribbon across an upper band, and the
  // headline / divided stats / PAWTCHI logotype anchored to the base.
  if (onPhoto) {
    return (
      <View style={[styles.card, { width, height, backgroundColor: ink.ink }]}>
        <Image source={{ uri: photoUri! }} style={StyleSheet.absoluteFill} contentFit="cover" />
        <LinearGradient
          colors={['rgba(8,10,12,0.55)', 'rgba(8,10,12,0)']}
          style={[styles.scrimTop, { height: Math.round(height * 0.34) }]}
          pointerEvents="none"
        />
        <LinearGradient
          colors={['rgba(8,10,12,0)', 'rgba(8,10,12,0.5)', 'rgba(8,10,12,0.9)']}
          locations={[0, 0.55, 1]}
          style={[styles.scrimBottom, { height: Math.round(height * 0.5) }]}
          pointerEvents="none"
        />

        {/* Place + date */}
        <View style={[styles.photoTop, { top: Math.round(height * 0.16) }]}>
          {placeLabel ? (
            <View style={styles.placeRow}>
              <MaterialIcons name="place" size={15} color={photoYellow} />
              <Text style={[styles.placeText, PHOTO_TEXT_SHADOW]} numberOfLines={1}>
                {placeLabel}
              </Text>
            </View>
          ) : null}
          <Text style={[styles.photoDate, PHOTO_TEXT_SHADOW, !placeLabel && { marginTop: 0 }]}>{dateLine}</Text>
        </View>

        {/* The route ribbon — the real projected walk, not a fixed curve */}
        <View style={{ position: 'absolute', left: CARD_PAD, top: photoRouteTop, width: zoneW, height: photoRouteH }}>
          {photoCompanion && (
            <Svg width={zoneW} height={photoRouteH} viewBox={`0 0 ${zoneW} ${photoRouteH}`}>
              {/* Dark halo under the line so it holds over pale photos */}
              <Path d={photoCompanion.path} fill="none" stroke="rgba(0,0,0,0.32)" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
              <Path d={photoCompanion.path} fill="none" stroke={photoYellow} strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" />
              {photoCompanion.loops.map((loop, i) => (
                <Circle key={i} cx={loop.x} cy={loop.y} r={loop.r} fill="none" stroke={photoYellow} strokeWidth={3} />
              ))}
              <Circle cx={photoCompanion.start.x} cy={photoCompanion.start.y} r={5} fill="#FFFFFF" stroke="rgba(0,0,0,0.28)" strokeWidth={1} />
              <PawMark x={photoCompanion.paw.x} y={photoCompanion.paw.y} onPhoto fill={photoYellow} />
            </Svg>
          )}

          {photoCompanion?.loops.map((loop, i) => {
            const caption = loopCaptions?.[i];
            return (
              <React.Fragment key={i}>
                {caption ? (
                  <Text
                    style={[styles.loopCaption, PHOTO_TEXT_SHADOW, { left: loop.x + loop.r + 6, top: loop.y - 6, color: ink.onPhotoSoft }]}
                    numberOfLines={1}
                  >
                    {caption}
                  </Text>
                ) : null}
                {onLoopPress && (
                  <Pressable
                    onPress={() => onLoopPress(i)}
                    hitSlop={8}
                    style={{
                      position: 'absolute',
                      left: loop.x - loop.r - 8,
                      top: loop.y - loop.r - 8,
                      width: (loop.r + 8) * 2,
                      height: (loop.r + 8) * 2,
                    }}
                  />
                )}
              </React.Fragment>
            );
          })}
        </View>

        {/* Headline · divided stats · logotype */}
        <View style={styles.photoLockup}>
          <Text style={styles.photoHeadline} numberOfLines={1}>
            {headline}
          </Text>
          <View style={styles.photoStatRow}>
            {statBlocks.map((s, idx) => {
              const [num, ...unit] = s.value.split(' ');
              return (
                <React.Fragment key={s.label}>
                  {idx > 0 && <View style={styles.statDivider} />}
                  <View style={styles.photoStat}>
                    <Text style={styles.photoStatNumber}>
                      {num}
                      {unit.length > 0 && <Text style={styles.photoStatUnit}> {unit.join(' ')}</Text>}
                    </Text>
                    <Text style={styles.photoStatLabel}>{s.label.toUpperCase()}</Text>
                  </View>
                </React.Fragment>
              );
            })}
          </View>
          <View style={styles.wordmarkWrap}>
            <PawtchiWordmark color={ink.onPhoto} height={20} />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.card, { width, height, backgroundColor: ground === 'map' ? ink.paperMap : ink.paper }]}>
      {ground === 'map' && <MapGround route={route} cardH={height} />}

      {/* Place + date, top center — same lockup as the photo card, in ink */}
      <View style={styles.topLockup}>
        {placeLabel ? (
          <View style={styles.placeRow}>
            <MaterialIcons name="place" size={13} color={ink.yellow} />
            <Text style={[styles.placeText, { fontSize: 13, color: ink.ink }]} numberOfLines={1}>
              {placeLabel}
            </Text>
          </View>
        ) : null}
        <Text style={[styles.photoDate, { color: captionColor, marginTop: placeLabel ? 4 : 0 }]}>{dateLine}</Text>
      </View>

      {/* The two lines */}
      <View style={{ position: 'absolute', left: CARD_PAD, top: HEADER_H, width: zoneW, height: zoneH }}>
        {ownerPath && companion && (
          <Svg width={zoneW} height={zoneH} viewBox={`0 0 ${zoneW} ${zoneH}`}>
            <Path d={companion.path} fill="none" stroke={ink.ink} strokeWidth={4.6} strokeLinecap="round" strokeLinejoin="round" opacity={0.14} />
            <Path d={companion.path} fill="none" stroke={ink.yellow} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
            <Path d={ownerPath} fill="none" stroke={ownerStroke} strokeWidth={1.6} strokeLinecap="round" opacity={0.75} />
            {companion.loops.map((loop, i) => (
              <Circle key={i} cx={loop.x} cy={loop.y} r={loop.r} fill="none" stroke={ink.yellow} strokeWidth={3} />
            ))}
            <Circle cx={companion.start.x} cy={companion.start.y} r={3.2} fill={ownerStroke} />
            <PawMark x={companion.paw.x} y={companion.paw.y} onPhoto={onPhoto} />
          </Svg>
        )}

        {/* Loop captions + tap targets */}
        {companion?.loops.map((loop, i) => {
          const caption = loopCaptions?.[i];
          return (
            <React.Fragment key={i}>
              {caption ? (
                <Text
                  style={[styles.loopCaption, { left: loop.x + loop.r + 6, top: loop.y - 6, color: captionColor }]}
                  numberOfLines={1}
                >
                  {caption}
                </Text>
              ) : null}
              {onLoopPress && (
                <Pressable
                  onPress={() => onLoopPress(i)}
                  hitSlop={8}
                  style={{
                    position: 'absolute',
                    left: loop.x - loop.r - 8,
                    top: loop.y - loop.r - 8,
                    width: (loop.r + 8) * 2,
                    height: (loop.r + 8) * 2,
                  }}
                />
              )}
            </React.Fragment>
          );
        })}
      </View>

      {/* Lockup — headline · divided stats · PAWTCHI logotype, in ink */}
      <View style={[styles.lockup, { height: LOCKUP_H }]}>
        <Text style={[styles.headline, { color: headlineColor }]} numberOfLines={1}>
          {headline}
        </Text>
        <View style={styles.statRow}>
          {statBlocks.map((s, idx) => {
            const [num, ...unit] = s.value.split(' ');
            return (
              <React.Fragment key={s.label}>
                {idx > 0 && <View style={[styles.statDivider, { backgroundColor: ink.hairline }]} />}
                <View style={styles.stat}>
                  <Text style={[styles.statNumber, { color: numberColor }]}>
                    {num}
                    {unit.length > 0 && <Text style={[styles.statUnit, { color: unitColor }]}> {unit.join(' ')}</Text>}
                  </Text>
                  <Text style={[styles.statLabel, { color: unitColor }]}>{s.label.toUpperCase()}</Text>
                </View>
              </React.Fragment>
            );
          })}
        </View>
        <View style={styles.wordmarkWrap}>
          <PawtchiWordmark color={ink.ink} height={18} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  topLockup: {
    position: 'absolute',
    top: 18,
    left: CARD_PAD,
    right: CARD_PAD,
    alignItems: 'center',
  },
  loopCaption: {
    position: 'absolute',
    fontFamily: font.momentRegular,
    fontSize: 9,
    maxWidth: 96,
  },
  osmCredit: {
    position: 'absolute',
    right: 8,
    fontFamily: font.momentRegular,
    fontSize: 7.5,
    color: color.moment.inkFaint,
  },
  lockup: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: CARD_PAD,
    paddingBottom: 14,
  },
  headline: {
    fontFamily: font.momentSemibold,
    fontSize: 10,
    letterSpacing: 2.4,
    textAlign: 'center',
  },
  statRow: {
    flexDirection: 'row',
    gap: 22,
    marginTop: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stat: {
    alignItems: 'center',
  },
  statNumber: {
    fontFamily: font.momentBold,
    fontSize: 16,
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
  statUnit: {
    fontFamily: font.momentMedium,
    fontSize: 10,
    letterSpacing: 0,
  },
  statLabel: {
    fontFamily: font.momentMedium,
    fontSize: 8,
    letterSpacing: 1.6,
    marginTop: 3,
  },

  // ── Photo ground ────────────────────────────────────────────────────────
  scrimTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  scrimBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  photoTop: {
    position: 'absolute',
    top: 30,
    left: CARD_PAD,
    right: CARD_PAD,
    alignItems: 'center',
  },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  placeText: {
    fontFamily: font.momentBold,
    fontSize: 15,
    letterSpacing: 0.2,
    color: color.moment.onPhoto,
    maxWidth: '86%',
  },
  photoDate: {
    marginTop: 5,
    fontFamily: font.momentSemibold,
    fontSize: 9.5,
    letterSpacing: 3,
    color: color.moment.onPhotoSoft,
  },
  photoLockup: {
    position: 'absolute',
    left: CARD_PAD,
    right: CARD_PAD,
    bottom: 26,
    alignItems: 'center',
  },
  photoHeadline: {
    fontFamily: font.momentSemibold,
    fontSize: 12,
    letterSpacing: 3.6,
    textAlign: 'center',
    color: color.moment.onPhoto,
    ...PHOTO_TEXT_SHADOW,
  },
  photoStatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 22,
    marginTop: 14,
  },
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: color.moment.onPhotoFaint,
  },
  photoStat: {
    alignItems: 'center',
  },
  photoStatNumber: {
    fontFamily: font.momentBold,
    fontSize: 24,
    letterSpacing: -0.4,
    color: color.moment.onPhoto,
    fontVariant: ['tabular-nums'],
    ...PHOTO_TEXT_SHADOW,
  },
  photoStatUnit: {
    fontFamily: font.momentMedium,
    fontSize: 12,
    letterSpacing: 0,
    color: color.moment.onPhotoSoft,
    ...PHOTO_TEXT_SHADOW,
  },
  photoStatLabel: {
    marginTop: 4,
    fontFamily: font.momentSemibold,
    fontSize: 8,
    letterSpacing: 2.2,
    color: color.moment.onPhotoFaint,
    ...PHOTO_TEXT_SHADOW,
  },
  wordmarkWrap: {
    marginTop: 18,
  },
});
