/**
 * WalkPostCard — the shareable "post" for a completed tracked walk.
 *
 * Sits on Home under the Second Opinion card, once per today's valid walk.
 * The whole thing is designed to look right in a screenshot: navy surface,
 * yellow route trace on a raised sub-card, pet-voiced headline, stat row,
 * and a share pill that reads as an invitation rather than a chore.
 *
 * Sharing opens the Paw Moment editor (MomentShareModal) — the same rich,
 * captured image card the post-walk summary uses. A walk without a drawable
 * route (patchy GPS, Expo Go) falls back to RN's built-in text Share.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Share, InteractionManager } from 'react-native';
import Svg, { Polyline, Circle } from 'react-native-svg';
import { Image } from 'expo-image';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { color, font, shadow } from '../constants/design';
import WalkMap from './walk/WalkMap';
import { MomentShareModal } from './MomentShareModal';
import { projectRouteToSvg } from '../lib/walk/routeSvg';
import { resolveSniffStops } from '../lib/momentCard';
import { track } from '../lib/analytics';
import { estimateActivityBurn } from '../lib/activityBurn';
import { deriveDogWalkProfile, intensityForPace } from '../lib/walk/dogCalibration';
import type { GeoPoint } from '../lib/walk/geo';
import type { WalkLabels } from '../lib/walk/geoLabels';
import type { Pet } from '../store/useActivePetStore';
import { useWalkPostPrefsStore } from '../store/useWalkPostPrefsStore';

export interface WalkPostCardData {
  id: string;
  started_at: string;
  duration_s: number;
  /** GPS moving time — the kcal basis; duration_s is elapsed, for display. */
  moving_time_s: number;
  distance_m: number;
  route: GeoPoint[] | null;
  /** Session pause coordinates — legacy fallback for the card loops. */
  pause_points: GeoPoint[];
  /** Sniff episodes ({lat,lng,dwellS}); null on rows predating the detector. */
  sniff_points: unknown[] | null;
  avg_speed_kmh: number | null;
  start_label: string | null;
  end_label: string | null;
  farthest_label: string | null;
}

export interface WalkPostCardProps {
  walk: WalkPostCardData;
  pet: Pet;
  /**
   * Position in the feed. Only the first few cards auto-mount the native map on
   * appear; later cards stay on the cheap SVG trace until the user taps the
   * map/trace toggle — a belt-and-braces cap on simultaneous GL surfaces.
   */
  index?: number;
  /**
   * The hero card directly under the canopy on Home: a taller route surface, so
   * the most recent walk reads as the thing that just happened rather than the
   * first row of a list. Purely presentational — same data, same behaviour.
   */
  featured?: boolean;
}

/** How many top cards auto-upgrade from SVG placeholder to a live basemap. */
const MAP_AUTOMOUNT_LIMIT = 3;

const SVG_WIDTH = 320;
const SVG_HEIGHT = 150;
/** Route surface height for the hero card under the canopy. */
const FEATURED_HEIGHT = 190;

function formatWhen(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function pluralizeMin(n: number): string {
  return `${n} min`;
}

export const WalkPostCard = React.memo(function WalkPostCard({ walk, pet, index = 0, featured = false }: WalkPostCardProps) {
  const petName = pet.name?.trim() || 'your dog';
  const routeHeight = featured ? FEATURED_HEIGHT : SVG_HEIGHT;
  // Match Home's existing avatar convention: wearable overlay wins over the raw
  // profile photo; paw glyph is the last-resort fallback if neither is set.
  const petPhotoUri = pet.current_avatar_url || pet.image_url || null;
  const minutes = Math.max(1, Math.round(walk.duration_s / 60));
  const km = Math.round((walk.distance_m / 1000) * 100) / 100;

  // Dog-calibrated kcal — same math the post-walk summary uses so the two
  // never disagree. Intensity is judged against THIS dog's pace band
  // (a Chihuahua's 4 km/h is a hard workout; a Lab's is a warm-up).
  // Based on MOVING time — sniff breaks and stillness burn ~nothing.
  const activeMinutes = Math.round(walk.moving_time_s / 60);
  const kcal = useMemo(() => {
    if (!pet.current_weight_kg) return 0;
    const profile = deriveDogWalkProfile({
      species: pet.species,
      breed: pet.breed ?? null,
      ageYears: pet.age_years ?? null,
      weightKg: pet.current_weight_kg,
      medicalConditions: pet.medical_conditions ?? null,
    });
    const intensity = intensityForPace(walk.avg_speed_kmh ?? 0, profile);
    return Math.round(
      estimateActivityBurn('walk', intensity, activeMinutes, pet.current_weight_kg),
    );
  }, [pet.species, pet.breed, pet.age_years, pet.current_weight_kg, pet.medical_conditions, walk.avg_speed_kmh, activeMinutes]);

  const projection = useMemo(
    () => projectRouteToSvg(walk.route ?? [], SVG_WIDTH, routeHeight, 18),
    [walk.route, routeHeight],
  );

  // Real sniff episodes, with the legacy auto-pause fallback for rows that
  // predate the detector — the same resolution the share card uses, so the two
  // can never disagree about how curious a walk was.
  const sniffCount = useMemo(
    () => resolveSniffStops(walk.sniff_points, walk.pause_points).length,
    [walk.sniff_points, walk.pause_points],
  );

  const showRoutePins = useWalkPostPrefsStore(s => s.showRoutePins);
  const hasRoute = Boolean(projection.points);

  // Route surface: a real basemap by default, the abstract SVG trace on tap.
  // The SVG also serves as the instant placeholder and the Expo-Go / no-route
  // fallback, so the map is a pure upgrade layered on top.
  const [viewMode, setViewMode] = useState<'map' | 'trace'>('map');
  const [mapReady, setMapReady] = useState(false);

  // Lazy-mount the native map after the first interactions settle so feed load
  // and first scroll are never blocked by map init. Only the top cards
  // auto-upgrade; the rest wait for an explicit toggle.
  useEffect(() => {
    if (!hasRoute || index >= MAP_AUTOMOUNT_LIMIT) return;
    const handle = InteractionManager.runAfterInteractions(() => setMapReady(true));
    return () => handle.cancel();
  }, [hasRoute, index]);

  const onToggleView = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    setViewMode(m => {
      const next = m === 'map' ? 'trace' : 'map';
      // An explicit request to see the map always mounts it, even for a card
      // past the auto-mount cap.
      if (next === 'map') setMapReady(true);
      return next;
    });
  }, []);

  const showMap = viewMode === 'map' && hasRoute && mapReady;

  // Loop-ness is inferred from which side of the route we labelled: a loop
  // has a `farthest_label`, a straight walk has an `end_label`. The pin
  // toggle also controls whether these show.
  const isLoop = Boolean(walk.farthest_label);
  const startLabel = walk.start_label;
  const trailingLabel = isLoop ? walk.farthest_label : walk.end_label;
  const showLabels = showRoutePins && Boolean(startLabel || trailingLabel);

  // Same label shape the Paw Moment card consumes on the walk-summary screen.
  const momentLabels: WalkLabels = {
    startLabel: walk.start_label,
    endLabel: walk.end_label,
    farthestLabel: walk.farthest_label,
    isLoop,
  };

  const subtitle = (() => {
    const when = formatWhen(walk.started_at);
    if (!showLabels) return when;
    if (isLoop && startLabel) return `${when} · Loop from ${startLabel}`;
    if (startLabel && trailingLabel) return `${when} · ${startLabel} → ${trailingLabel}`;
    if (startLabel) return `${when} · from ${startLabel}`;
    if (trailingLabel) return `${when} · to ${trailingLabel}`;
    return when;
  })();

  const [shareOpen, setShareOpen] = useState(false);
  // A drawable route (>=2 points) becomes the rich Paw Moment card. Without
  // one (patchy GPS, Expo Go) fall back to the plain-text share so the button
  // never dead-ends.
  const canShareCard = (walk.route?.length ?? 0) >= 2;
  const onShare = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (canShareCard) {
      setShareOpen(true);
      track('walk_shared', { walk_session_id: walk.id, km, minutes, kcal, mode: 'moment_card' });
      return;
    }
    try {
      const message = `${petName} walked ${km.toFixed(2)} km with me today — ${pluralizeMin(minutes)} together. Tracked with Pawtchi.`;
      await Share.share({ message });
      track('walk_shared', { walk_session_id: walk.id, km, minutes, kcal, mode: 'text' });
    } catch {
      // User dismissed the share sheet — nothing to do.
    }
  }, [walk.id, canShareCard, petName, km, minutes, kcal]);

  return (
    <View style={styles.card}>
      {/* Header — pet-voiced, ambient time */}
      <View style={styles.header}>
        {petPhotoUri ? (
          <Image
            source={{ uri: petPhotoUri }}
            style={styles.headerAvatar}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={120}
          />
        ) : (
          <View style={styles.headerIcon}>
            <MaterialIcons name="pets" size={16} color={color.navy} />
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title} numberOfLines={1}>
            {petName}&apos;s walk
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
        </View>
        {hasRoute && (
          <TouchableOpacity
            onPress={onToggleView}
            style={styles.headerIconBtn}
            activeOpacity={0.6}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel={viewMode === 'map' ? 'Show simplified route trace' : 'Show route on map'}
            accessibilityRole="switch"
            accessibilityState={{ checked: viewMode === 'map' }}
          >
            <MaterialIcons
              name={viewMode === 'map' ? 'timeline' : 'map'}
              size={18}
              color={color.navy}
            />
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={onShare}
          style={styles.headerIconBtn}
          activeOpacity={0.6}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityLabel="Share walk"
          accessibilityRole="button"
        >
          <MaterialCommunityIcons name="share" size={20} color={color.navy} />
        </TouchableOpacity>
      </View>

      {/* Route surface — a real basemap by default, abstract trace on tap */}
      <View style={styles.routeCard}>
        {showMap ? (
          <View style={[styles.postMap, { height: routeHeight }]}>
            <WalkMap mode="summary" path={walk.route ?? []} interactive={false} />
          </View>
        ) : projection.points ? (
          <>
          <Svg width="100%" height={routeHeight} viewBox={`0 0 ${SVG_WIDTH} ${routeHeight}`}>
            <Polyline
              points={projection.points}
              fill="none"
              stroke={color.navy}
              strokeWidth={3.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {showRoutePins && projection.start && (
              <Circle
                cx={projection.start.x}
                cy={projection.start.y}
                r={5.5}
                fill={color.yellow}
                stroke={color.navy}
                strokeWidth={1.5}
              />
            )}
            {showRoutePins && projection.end && (
              <Circle cx={projection.end.x} cy={projection.end.y} r={4.5} fill={color.navy} />
            )}
          </Svg>
          {showLabels && startLabel && (
            <View style={[styles.rtePill, styles.rtePillStart]} pointerEvents="none">
              <MaterialIcons
                name={isLoop ? 'home' : 'place'}
                size={10}
                color={color.navy}
              />
              <Text style={styles.rtePillText} numberOfLines={1}>{startLabel}</Text>
            </View>
          )}
          {showLabels && trailingLabel && (
            <View style={[styles.rtePill, styles.rtePillEnd]} pointerEvents="none">
              <MaterialIcons
                name={isLoop ? 'landscape' : 'flag'}
                size={10}
                color={color.navy}
              />
              <Text style={styles.rtePillText} numberOfLines={1}>{trailingLabel}</Text>
            </View>
          )}
          </>
        ) : (
          <View style={[styles.routePlaceholder, { height: routeHeight }]}>
            <MaterialIcons name="terrain" size={26} color={color.slateFaint} />
          </View>
        )}
      </View>

      {/* Stat row — minutes, km, sniff stops, kcal (dog-calibrated).
          Sniff stops carry the electric blue: of everything on this card it is
          the only number about what the dog *found* rather than what the walk
          cost, which is exactly what that colour is reserved for. */}
      <View style={styles.statRow}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{minutes}</Text>
          <Text style={styles.statLabel}>MINUTES</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={styles.statValue}>{km.toFixed(2)}</Text>
          <Text style={styles.statLabel}>KM</Text>
        </View>
        {sniffCount > 0 && (
          <>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Text style={[styles.statValue, styles.statValueFound]}>{sniffCount}</Text>
              <Text style={styles.statLabel}>SNIFF STOPS</Text>
            </View>
          </>
        )}
        {kcal > 0 && (
          <>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Text style={styles.statValue}>{kcal}</Text>
              <Text style={styles.statLabel}>KCAL BURNED</Text>
            </View>
          </>
        )}
      </View>

      {canShareCard && (
        <MomentShareModal
          visible={shareOpen}
          onClose={() => setShareOpen(false)}
          source="home_feed"
          petName={petName}
          petGender={pet.gender ?? null}
          startedAt={new Date(walk.started_at).getTime()}
          route={walk.route ?? []}
          sniffStops={resolveSniffStops(walk.sniff_points, walk.pause_points)}
          labels={momentLabels}
          stats={{
            durationS: walk.duration_s,
            movingTimeS: walk.moving_time_s,
            distanceM: walk.distance_m,
          }}
          sessionId={walk.id}
        />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.surface,
    borderRadius: 20,
    padding: 16,
    borderWidth: 0.5,
    borderColor: color.hairline,
    ...shadow.card,
    // Deliberately no margin. Spacing between cards belongs to whatever is
    // stacking them — a self-applied marginTop here added itself to the Home
    // sheet's section `gap` and made this card sit further from the shelf above
    // it than any other pair of sections on the screen.
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    // Subtle navy tint so the icon has a home without introducing a new color.
    backgroundColor: 'rgba(7, 32, 42, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: color.surfaceSubtle,
  },
  title: {
    fontFamily: font.bold,
    fontSize: 15,
    color: color.navy,
    letterSpacing: -0.2,
  },
  subtitle: {
    fontFamily: font.medium,
    fontSize: 11.5,
    color: color.slateMuted,
    marginTop: 1,
    letterSpacing: 0.2,
  },
  headerIconBtn: {
    // Flat icon-only affordance — no chip, no border. State reads from the
    // icon color alone so the header stays clean and the route is the hero.
    padding: 4,
    marginLeft: 4,
  },
  routeCard: {
    // Warm-paper sub-card sets the route trace apart from the outer surface
    // without needing a full navy backdrop.
    backgroundColor: color.surfaceSubtle,
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: color.hairline,
    padding: 8,
    marginTop: 14,
    marginBottom: 14,
  },
  routePlaceholder: {
    height: SVG_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postMap: {
    // Fixed height for layout parity with the SVG trace — WalkMap fills its
    // container via flex/absoluteFill, so it needs an explicit box here.
    height: SVG_HEIGHT,
    borderRadius: 10,
    overflow: 'hidden',
  },
  rtePill: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: color.surface,
    borderWidth: 0.5,
    borderColor: color.navy,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
    maxWidth: '55%',
  },
  rtePillStart: {
    bottom: 6,
    left: 6,
  },
  rtePillEnd: {
    top: 6,
    right: 6,
    borderColor: color.yellow,
    backgroundColor: '#FFFDE0',
  },
  rtePillText: {
    fontFamily: font.bold,
    fontSize: 9.5,
    color: color.navy,
    letterSpacing: 0.2,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 4,
    paddingBottom: 2,
  },
  stat: {
    alignItems: 'center',
    gap: 2,
    minWidth: 70,
  },
  statValue: {
    fontFamily: font.display,
    fontSize: 26,
    lineHeight: 28,
    color: color.navy,
    letterSpacing: 0.5,
  },
  // Discovery, not effort — see the `electric` note in constants/design.ts.
  statValueFound: {
    color: color.electric,
  },
  statLabel: {
    fontFamily: font.semibold,
    fontSize: 9.5,
    color: color.slateFaint,
    letterSpacing: 1.2,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 26,
    backgroundColor: color.hairline,
  },
});
