import React, { useEffect, useMemo, useState } from 'react';
import { SectionList, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';

import { color, font, radius, space } from '../constants/design';
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
import { fetchKeepsakeCounts } from '../lib/walk/keepsakeSync';
import { WALK_CAMERA_ENABLED } from '../constants/features';
import { PawPrintRecapCard } from '../components/pawprints/PawPrintRecapCard';
import { PawPrintShareModal } from '../components/pawprints/PawPrintShareModal';
import { MomentShareModal } from '../components/MomentShareModal';
import type { GeoPoint } from '../lib/walk/geo';
import type { WalkLabels } from '../lib/walk/geoLabels';

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

  const sharedLabels: WalkLabels | null = sharedWalk
    ? {
        startLabel: sharedWalk.start_label,
        endLabel: sharedWalk.end_label,
        farthestLabel: sharedWalk.farthest_label,
        // Same inference WalkPostCard uses: loops labelled their farthest point.
        isLoop: Boolean(sharedWalk.farthest_label),
      }
    : null;

  return (
    <View style={[styles.container, { paddingTop: insets.top + space.md }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <MaterialIcons name="arrow-back" size={24} color={color.ink} />
        </TouchableOpacity>
        <Text style={styles.title}>Walk gallery</Text>
        <View style={{ width: 24 }} />
      </View>

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
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingBottom: space.md,
  },
  title: {
    fontFamily: font.bold,
    fontSize: 17,
    color: color.ink,
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
