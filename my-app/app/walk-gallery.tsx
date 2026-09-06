import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { SectionList, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';

import { color, font, makeShadow, radius, space } from '../constants/design';
import { useWalkEnabled } from '../hooks/useWalkEnabled';
import { supabase } from '../lib/supabase';
import { track } from '../lib/analytics';
import { haptic } from '../lib/haptics';
import {
  aggregateWalks,
  buildMonthlyRecap,
  formatKm,
  nextDistanceMilestone,
  PawPrintWalk,
  previousMonthKey,
} from '../lib/pawPrints';
import {
  MOMENT_TEMPLATES,
  nextTemplateChipLine,
  unlockedTemplateIds,
} from '../lib/momentTemplates';
import { resolveSniffStops } from '../lib/momentCard';
import { chunk, groupSummary, groupWalksByPlace } from '../lib/walkGallery';
import { evaluatePawPrints } from '../lib/pawPrintsSync';
import { useActivePetStore } from '../store/useActivePetStore';
import { useAuth } from '../providers/AuthProvider';
import { WalkTile } from '../components/pawprints/WalkTile';
import { fetchKeepsakeCounts, fetchKeepsakesForWalks } from '../lib/walk/keepsakeSync';
import { WALK_CAMERA_ENABLED } from '../constants/features';
import { PawPrintRecapCard } from '../components/pawprints/PawPrintRecapCard';
import { PawPrintShareModal } from '../components/pawprints/PawPrintShareModal';
import { MomentShareModal } from '../components/MomentShareModal';
import { MemoryMapLayer } from '../components/gallery/MemoryMapLayer';
import { buildMemoryMap, memoryMapHeadline } from '../lib/memoryMap';
import { NATIVE_MAP_AVAILABLE } from '../components/walk/WalkMap';
import type { KeepsakeWalkContext } from '../components/walk/KeepsakeViewer';
import type { Keepsake } from '../lib/walk/keepsake';
import type { GeoPoint } from '../lib/walk/geo';
import type { WalkLabels } from '../lib/walk/geoLabels';

/**
 * Which view of the archive is on screen.
 *
 * `null` while the walks are still loading: the default depends on whether the
 * map has anything to draw, and guessing before the rows land would flash the
 * grid at everyone for a beat and then swap it out from under them.
 */
type GalleryView = 'map' | 'grid';

interface GalleryRow {
  id: string;
  started_at: string;
  duration_s: number;
  moving_time_s: number;
  distance_m: number;
  route: GeoPoint[] | null;
  pause_points: GeoPoint[] | null;
  /** Sniff episodes ({lat,lng,dwellS}); null on rows predating the detector. */
  sniff_points: unknown[] | null;
  start_label: string | null;
  end_label: string | null;
  farthest_label: string | null;
}

function toPawPrintWalk(r: GalleryRow): PawPrintWalk {
  return {
    id: r.id,
    startedAt: r.started_at,
    distanceM: Number(r.distance_m) || 0,
    durationS: r.duration_s ?? 0,
    sniffCount: resolveSniffStops(r.sniff_points, r.pause_points).length,
    startLabel: r.start_label,
    endLabel: r.end_label,
    farthestLabel: r.farthest_label,
  };
}

// Gate wrapper, same pattern as walk.tsx — when walks are unavailable (release
// flag off, or a cat profile — walks are dogs-only) this route and any deep
// link to it bounce straight back to the tabs.
export default function WalkGalleryScreen() {
  const walkEnabled = useWalkEnabled();
  if (!walkEnabled) return <Redirect href="/(tabs)" />;
  return <WalkGalleryInner />;
}

function WalkGalleryInner() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const { user } = useAuth();
  const activePet = useActivePetStore((s) => s.activePet);

  const [rows, setRows] = useState<GalleryRow[] | null>(null);
  const [awardedIds, setAwardedIds] = useState<string[]>([]);
  const [sharedWalk, setSharedWalk] = useState<GalleryRow | null>(null);
  const [recapShareOpen, setRecapShareOpen] = useState(false);
  const recapViewedRef = React.useRef(false);

  const [view, setView] = useState<GalleryView | null>(null);
  const [keepsakes, setKeepsakes] = useState<Keepsake[]>([]);
  /** The walk lifted out of the trail web into the cased yellow. */
  const [mapWalkId, setMapWalkId] = useState<string | null>(null);
  const [mapPanned, setMapPanned] = useState(false);
  const [recentreNonce, setRecentreNonce] = useState(0);

  const petId = activePet?.id ?? null;
  const petName = activePet?.name?.trim() || 'your dog';

  useEffect(() => {
    track('pawprint_gallery_viewed', {});
  }, []);

  useEffect(() => {
    if (!petId) return;
    let cancelled = false;
    (async () => {
      // Newest 120 walks — ~4 months of daily walking; pagination can come
      // when an archive actually outgrows this.
      //
      // `neq likely_vehicle`, exactly matching useRecentWalks. This used to be
      // `eq valid`, which silently disagreed with Home: verdicts are one of
      // valid / too_short / likely_vehicle / gps_junk, so a short amble or a
      // patchy-GPS walk appeared in the Home rail and then could not be found
      // here at all. A walk someone was shown must remain findable.
      const { data, error } = await supabase
        .from('walk_sessions')
        .select('id, started_at, duration_s, moving_time_s, distance_m, route, pause_points, sniff_points, start_label, end_label, farthest_label')
        .eq('pet_id', petId)
        .neq('validation_verdict', 'likely_vehicle')
        .order('started_at', { ascending: false })
        .limit(120);
      if (!cancelled && !error) setRows((data ?? []) as GalleryRow[]);
    })();
    // The persisted awards — the shelf's earned/locked split reads these so
    // an unlock survives even if the 120-row window undercounts the archive.
    (async () => {
      const { data } = await supabase
        .from('pet_milestones')
        .select('milestone_id')
        .eq('pet_id', petId);
      if (!cancelled && data) setAwardedIds(data.map((r) => r.milestone_id as string));
    })();
    // Catch-up award check — walks synced while the app was dead may have
    // crossed a rung nobody celebrated yet.
    if (user?.id) evaluatePawPrints(petId, user.id).catch(() => {});
    return () => { cancelled = true; };
  }, [petId, user?.id]);

  /**
   * Moment counts per walk, for the tile badges.
   *
   * One query for the whole grid, fired after the rows land. Absent counts read
   * as zero, so a slow or failed fetch simply shows the gallery as it was —
   * badges are an annotation on the collection, never a precondition for it.
   */
  const [momentCounts, setMomentCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!WALK_CAMERA_ENABLED || !rows || rows.length === 0) return;
    let cancelled = false;
    void fetchKeepsakeCounts(rows.map(r => r.id)).then(counts => {
      if (!cancelled) setMomentCounts(counts);
    });
    return () => {
      cancelled = true;
    };
  }, [rows]);

  /**
   * The placed moments across the whole archive — the map's photo layer.
   *
   * Scoped to the rows this screen actually holds rather than to the pet, so the
   * map and the grid can never disagree about what the archive is. One query for
   * the page, and a failure simply leaves the map showing trails and tiles,
   * which is still a complete picture.
   */
  useEffect(() => {
    if (!WALK_CAMERA_ENABLED || !rows || rows.length === 0) return;
    let cancelled = false;
    void fetchKeepsakesForWalks(rows.map(r => r.id)).then(found => {
      if (!cancelled) setKeepsakes(found);
    });
    return () => {
      cancelled = true;
    };
  }, [rows]);

  const walks = useMemo(() => (rows ?? []).map(toPawPrintWalk), [rows]);
  const totals = useMemo(() => aggregateWalks(walks), [walks]);
  const nextMilestone = useMemo(() => nextDistanceMilestone(totals), [totals]);
  const unlockedTemplates = useMemo(
    () => unlockedTemplateIds(totals.walkCount, awardedIds),
    [totals.walkCount, awardedIds],
  );
  const templateChip = useMemo(
    () => nextTemplateChipLine(totals.walkCount),
    [totals.walkCount],
  );
  const recap = useMemo(
    () => buildMonthlyRecap(walks, previousMonthKey(new Date()), petName),
    [walks, petName],
  );
  const recapTiles = useMemo(() => {
    if (!recap || !rows) return [];
    const byId = new Map(rows.map((r) => [r.id, r.route]));
    return recap.tileSessionIds.map((id) => ({ id, route: byId.get(id) ?? null }));
  }, [recap, rows]);

  useEffect(() => {
    if (recap && !recapViewedRef.current) {
      recapViewedRef.current = true;
      track('pawprint_recap_viewed', { month: recap.monthKey });
    }
  }, [recap]);

  const pad = space.xl;
  const gap = space.sm;
  const tileSize = Math.floor((winW - pad * 2 - gap * 2) / 3);

  /**
   * The archive, clubbed by where each walk set off from.
   *
   * A flat date-ordered grid works for a handful of walks and stops working at
   * fifty: every tile is a small grey squiggle and "the one along the beach" is
   * unfindable by eye. Place is what people actually remember.
   *
   * SectionList cannot do `numColumns`, so each section's data is pre-chunked
   * into rows of three and `renderItem` draws a row.
   */
  const sections = useMemo(() => {
    const groups = groupWalksByPlace(rows ?? []);
    return groups.map((group) => ({
      key: group.key,
      label: group.label,
      summary: groupSummary(group),
      data: chunk(group.walks, 3),
    }));
  }, [rows]);

  // ── The map view ───────────────────────────────────────────────────────────

  const memoryMap = useMemo(
    () => buildMemoryMap({ walks: rows ?? [], keepsakes }),
    [rows, keepsakes],
  );

  /**
   * Whether the map is worth offering at all.
   *
   * Two ways it is not, and both end the same way — no segmented control, grid
   * alone. A device that cannot draw a basemap (Expo Go) would get the "Map
   * preview" placeholder, which is worse than never having been offered the
   * choice. And an archive with no usable route has nothing to put on a map;
   * the grid can still draw those walks as a paw mark, so it is the honest home
   * for them.
   */
  const mapOfferable =
    NATIVE_MAP_AVAILABLE && (memoryMap.trails.length > 0 || memoryMap.photoPins.length > 0);

  // Settled once, when the walks land. Guarded on `view` rather than run on
  // mount so it reflects a real answer, and so it can never overrule a toggle
  // the owner has already made.
  useEffect(() => {
    if (view !== null || rows === null) return;
    setView(mapOfferable ? 'map' : 'grid');
  }, [view, rows, mapOfferable]);

  const onMap = view === 'map';

  const mapViewedRef = React.useRef(false);
  useEffect(() => {
    if (!onMap || mapViewedRef.current) return;
    mapViewedRef.current = true;
    track('memory_map_viewed', {
      walks: rows?.length ?? 0,
      photo_pins: memoryMap.photoPins.length,
      tile_pins: memoryMap.tilePins.length,
    });
  }, [onMap, rows, memoryMap]);

  // Place count comes from the grid's own grouping, so the two views of one
  // archive can never quote different numbers at the same person.
  const headline = useMemo(
    () => memoryMapHeadline(totals.totalKm, sections.length),
    [totals.totalKm, sections.length],
  );

  const rowsById = useMemo(
    () => new Map((rows ?? []).map((r) => [r.id, r])),
    [rows],
  );

  /**
   * What a walk knows, so an opened photograph can be described and not just
   * shown. Built from rows the screen already holds — the viewer must never have
   * to re-read a walk to caption a picture of it.
   */
  const contextForWalk = useCallback(
    (walkSessionId: string): KeepsakeWalkContext => {
      const row = rowsById.get(walkSessionId);
      return {
        petId,
        petName,
        // The same fallback order the gallery groups by: where you set off from,
        // then the far end of the walk, then where it finished.
        placeLabel: row?.start_label ?? row?.farthest_label ?? row?.end_label ?? null,
        route: row?.route ?? [],
        durationS: row?.duration_s ?? null,
      };
    },
    [rowsById, petId, petName],
  );

  const onMapWalkPress = useCallback(
    (walkSessionId: string) => {
      const row = rowsById.get(walkSessionId);
      if (!row) return;
      // Selecting lifts the walk out of the web AND opens its editor: the map
      // answers "which one is this" behind the sheet that opens over it.
      setMapWalkId(walkSessionId);
      track('memory_map_pin_opened', { kind: 'walk', walk_session_id: walkSessionId });
      setSharedWalk(row);
    },
    [rowsById],
  );

  const onToggleView = useCallback((next: GalleryView) => {
    haptic.tap();
    setView(next);
    track('memory_map_view_toggled', { to: next });
  }, []);

  const sharedLabels: WalkLabels | null = sharedWalk
    ? {
        startLabel: sharedWalk.start_label,
        endLabel: sharedWalk.end_label,
        farthestLabel: sharedWalk.farthest_label,
        // Same inference WalkPostCard uses: loops labelled their farthest point.
        isLoop: Boolean(sharedWalk.farthest_label),
      }
    : null;

  /** Room the floating chrome needs above the map before a pin may be framed. */
  const mapTopInset = insets.top + space.md + 40 + (headline ? 46 : 0);

  return (
    <View style={styles.container}>
      {/* Layer 1 — the map, edge to edge, running underneath the chrome. Same
          discipline as Home: nothing covers it, everything floats on it. */}
      {onMap && (
        <MemoryMapLayer
          map={memoryMap}
          contextForWalk={contextForWalk}
          selectedWalkId={mapWalkId}
          selectedRoute={mapWalkId ? rowsById.get(mapWalkId)?.route ?? null : null}
          onWalkPress={onMapWalkPress}
          frameTopInset={mapTopInset}
          onPannedChange={setMapPanned}
          recentreNonce={recentreNonce}
        />
      )}

      <View
        style={[styles.header, { paddingTop: insets.top + space.md }]}
        pointerEvents="box-none"
      >
        <TouchableOpacity
          style={onMap ? styles.backFloating : styles.backPlain}
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <MaterialIcons name="arrow-back" size={onMap ? 20 : 24} color={color.ink} />
        </TouchableOpacity>

        {/* The title stands on the grid's white page. Over the map the
            segmented control already says where you are, and a bare heading on
            live tiles is the one thing the whole floating-chrome rule exists to
            avoid. */}
        {!onMap && <Text style={styles.title}>Walk gallery</Text>}

        <View style={{ flex: 1 }} pointerEvents="none" />

        {mapOfferable && view !== null && (
          <View style={styles.segmented}>
            {(['map', 'grid'] as GalleryView[]).map((key) => {
              const active = key === view;
              return (
                <TouchableOpacity
                  key={key}
                  style={[styles.segment, active && styles.segmentActive]}
                  activeOpacity={0.85}
                  onPress={() => onToggleView(key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                    {key === 'map' ? 'Map' : 'Grid'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>

      {/* The one line the map states outright. It also carries the recap, which
          otherwise lives in the grid header and would be orphaned by opening on
          the map. */}
      {onMap && !!headline && (
        <View style={styles.headlineRow} pointerEvents="box-none">
          <TouchableOpacity
            style={styles.headlineChip}
            activeOpacity={recap ? 0.85 : 1}
            disabled={!recap}
            onPress={() => {
              if (!recap) return;
              haptic.tap();
              setRecapShareOpen(true);
            }}
            accessibilityRole={recap ? 'button' : 'text'}
            accessibilityLabel={
              recap ? `${headline}. Open ${recap.monthLabel}'s Paw Print` : headline
            }
          >
            <MaterialCommunityIcons name="paw" size={13} color={color.navy} />
            <Text style={styles.headlineText}>{headline}</Text>
          </TouchableOpacity>
        </View>
      )}

      {onMap && mapPanned && (
        <TouchableOpacity
          style={[styles.recentre, { bottom: insets.bottom + space.xxl }]}
          activeOpacity={0.85}
          onPress={() => {
            haptic.tap();
            setRecentreNonce((n) => n + 1);
          }}
          accessibilityRole="button"
          accessibilityLabel="Frame the whole archive"
        >
          <MaterialIcons name="filter-center-focus" size={19} color={color.ink} />
        </TouchableOpacity>
      )}

      {/* `view === 'grid'`, never `!onMap`: until the walks land the answer is
          genuinely unknown, and the negation would render the grid through the
          whole load and then swap it for the map the instant rows arrived —
          a flash of the wrong screen on every open. */}
      {view === 'grid' && (
        <SectionList
          sections={sections}
          keyExtractor={(row, index) => `${row[0]?.id ?? 'row'}-${index}`}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingHorizontal: pad, paddingBottom: insets.bottom + 40, gap }}
          ListHeaderComponent={
            <View style={styles.headerBlock}>
              <Text style={styles.subtitle}>Every walk draws something different.</Text>

              {/* Goal-gradient: the next distance rung is always in sight. */}
              {rows && rows.length > 0 && nextMilestone && (
                <View style={styles.progressChip}>
                  <MaterialCommunityIcons name="paw" size={14} color={color.navy} />
                  <Text style={styles.progressText}>
                    <Text style={styles.progressBold}>{formatKm(totals.totalKm)} km</Text>
                    {' '}together · {formatKm(nextMilestone.remainingKm)} km to {nextMilestone.threshold}
                  </Text>
                </View>
              )}

              {/* The card shelf — earned templates bright, the rest waiting.
                  Tapping any walk tile opens the picker where they all live. */}
              {rows && rows.length > 0 && (
                <View style={styles.shelf}>
                  {MOMENT_TEMPLATES.map((t) => {
                    const earned = unlockedTemplates.has(t.id);
                    return (
                      <View key={t.id} style={[styles.shelfChip, !earned && styles.shelfChipLocked]}>
                        {earned ? (
                          <MaterialCommunityIcons name="paw" size={12} color={color.navy} />
                        ) : (
                          <MaterialIcons name="lock" size={12} color={color.slateFaint} />
                        )}
                        <Text style={[styles.shelfChipText, !earned && styles.shelfChipTextLocked]}>
                          {t.name}
                          {!earned && t.unlockAtWalks != null ? ` · at ${t.unlockAtWalks}` : ''}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}
              {rows && rows.length > 0 && templateChip && (
                <Text style={styles.templateChipLine}>{templateChip}</Text>
              )}

              {/* Last month's Paw Print — tap to share. */}
              {recap && (
                <TouchableOpacity
                  activeOpacity={0.9}
                  style={styles.recapWrap}
                  onPress={() => {
                    haptic.tap();
                    setRecapShareOpen(true);
                  }}
                >
                  <PawPrintRecapCard recap={recap} tiles={recapTiles} width={winW - pad * 2} />
                  <View style={styles.recapShareHint}>
                    <MaterialIcons name="ios-share" size={14} color={color.slateMuted} />
                    <Text style={styles.recapShareHintText}>Tap to share {recap.monthLabel.toLowerCase()}&apos;s Paw Print</Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>
          }
          ListEmptyComponent={
            rows === null ? null : (
              <View style={styles.empty}>
                <MaterialCommunityIcons name="paw" size={40} color={color.slateFaint} />
                <Text style={styles.emptyText}>
                  The first tracked walk draws the first tile.
                </Text>
              </View>
            )
          }
          renderSectionHeader={({ section }) => (
            <View style={styles.placeHeader}>
              <Text style={styles.placeName} numberOfLines={1}>
                {section.label}
              </Text>
              <Text style={styles.placeSummary}>{section.summary}</Text>
            </View>
          )}
          renderItem={({ item: row }) => (
            <View style={{ flexDirection: 'row', gap }}>
              {row.map((walkRow) => (
                <TouchableOpacity
                  key={walkRow.id}
                  activeOpacity={0.85}
                  onPress={() => {
                    haptic.tap();
                    track('pawprint_tile_opened', { walk_session_id: walkRow.id });
                    setSharedWalk(walkRow);
                  }}
                >
                  <WalkTile
                    route={walkRow.route}
                    size={tileSize}
                    momentCount={momentCounts[walkRow.id] ?? 0}
                  />
                </TouchableOpacity>
              ))}
            </View>
          )}
        />
      )}

      {/* Tile → the full Paw Moment editor for that walk. */}
      {sharedWalk && sharedLabels && activePet && (
        <MomentShareModal
          visible
          onClose={() => setSharedWalk(null)}
          source="walk_gallery"
          petName={petName}
          petGender={activePet.gender ?? null}
          startedAt={new Date(sharedWalk.started_at).getTime()}
          route={sharedWalk.route ?? []}
          sniffStops={resolveSniffStops(sharedWalk.sniff_points, sharedWalk.pause_points)}
          labels={sharedLabels}
          stats={{
            durationS: sharedWalk.duration_s,
            movingTimeS: sharedWalk.moving_time_s,
            distanceM: sharedWalk.distance_m,
          }}
          sessionId={sharedWalk.id}
        />
      )}

      {/* Recap share — the same card, captured. */}
      {recap && (
        <PawPrintShareModal
          visible={recapShareOpen}
          onClose={() => setRecapShareOpen(false)}
          source="monthly_recap"
        >
          <PawPrintRecapCard recap={recap} tiles={recapTiles} width={300} />
        </PawPrintShareModal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingBottom: space.md,
  },
  title: {
    fontFamily: font.bold,
    fontSize: 17,
    color: color.ink,
  },
  backPlain: {
    width: 24,
    alignItems: 'center',
  },
  // Over the map every control is its own elevated white object — a bare glyph
  // on live tiles is unreadable the moment it crosses a dark park.
  backFloating: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...makeShadow(3, 12, 0.14),
  },
  // The app's one segmented control, taken from Home's top bar so the two read
  // as the same object rather than as two dialects.
  segmented: {
    flexDirection: 'row',
    backgroundColor: color.surface,
    borderRadius: radius.pill,
    padding: 3,
    ...makeShadow(2, 10, 0.1),
  },
  segment: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: radius.pill,
  },
  segmentActive: {
    backgroundColor: color.ink,
  },
  segmentText: {
    fontFamily: font.semibold,
    fontSize: 12.5,
    color: color.slateMuted,
  },
  segmentTextActive: {
    color: color.surface,
  },
  headlineRow: {
    alignItems: 'center',
    paddingHorizontal: space.xl,
  },
  headlineChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: color.surface,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 9,
    ...makeShadow(3, 12, 0.14),
  },
  headlineText: {
    fontFamily: font.semibold,
    fontSize: 12.5,
    color: color.ink,
  },
  recentre: {
    position: 'absolute',
    right: space.lg,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...makeShadow(3, 12, 0.14),
  },
  headerBlock: {
    gap: space.lg,
    marginBottom: space.lg,
  },
  subtitle: {
    fontFamily: font.regular,
    fontSize: 14,
    color: color.slateMuted,
  },
  // Sits directly on the page rather than in a card or a tinted band: the tiles
  // below it are the content, and a heavy header would compete with the grid it
  // is only there to label.
  placeHeader: {
    paddingTop: space.xl,
    paddingBottom: space.sm,
  },
  placeName: {
    fontFamily: font.bold,
    fontSize: 16,
    color: color.ink,
    letterSpacing: -0.2,
  },
  placeSummary: {
    fontFamily: font.regular,
    fontSize: 12.5,
    color: color.slateMuted,
    marginTop: 1,
  },
  progressChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    backgroundColor: color.yellowSoft,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  progressText: {
    fontFamily: font.medium,
    fontSize: 12.5,
    color: color.navy,
  },
  progressBold: {
    fontFamily: font.bold,
  },
  shelf: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  shelfChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: color.yellowSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  shelfChipLocked: {
    backgroundColor: color.track,
  },
  shelfChipText: {
    fontFamily: font.semibold,
    fontSize: 11.5,
    color: color.navy,
  },
  shelfChipTextLocked: {
    fontFamily: font.medium,
    color: color.slateMuted,
  },
  templateChipLine: {
    fontFamily: font.medium,
    fontSize: 12,
    color: color.slateMuted,
  },
  recapWrap: {
    alignItems: 'center',
    gap: space.sm,
  },
  recapShareHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  recapShareHintText: {
    fontFamily: font.semibold,
    fontSize: 12,
    color: color.slateMuted,
  },
  empty: {
    alignItems: 'center',
    gap: space.md,
    paddingVertical: 60,
  },
  emptyText: {
    fontFamily: font.medium,
    fontSize: 13.5,
    color: color.slateMuted,
    textAlign: 'center',
    maxWidth: 240,
  },
});
