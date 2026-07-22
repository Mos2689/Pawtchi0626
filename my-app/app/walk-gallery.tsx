import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';

import { color, font, radius, space } from '../constants/design';
import { WALK_TRACKING_ENABLED } from '../constants/features';
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
import { evaluatePawPrints } from '../lib/pawPrintsSync';
import { useActivePetStore } from '../store/useActivePetStore';
import { useAuth } from '../providers/AuthProvider';
import { WalkTile } from '../components/pawprints/WalkTile';
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
    sniffCount: Array.isArray(r.pause_points) ? r.pause_points.length : 0,
    startLabel: r.start_label,
    endLabel: r.end_label,
    farthestLabel: r.farthest_label,
  };
}

// Gate wrapper, same pattern as walk.tsx — with walks disabled this route
// (and any deep link to it) bounces straight back to the tabs.
export default function WalkGalleryScreen() {
  if (!WALK_TRACKING_ENABLED) return <Redirect href="/(tabs)" />;
  return <WalkGalleryInner />;
}

function WalkGalleryInner() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const { user } = useAuth();
  const activePet = useActivePetStore((s) => s.activePet);

  const [rows, setRows] = useState<GalleryRow[] | null>(null);
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
      // Newest 120 valid walks — ~4 months of daily walking; pagination can
      // come when an archive actually outgrows this.
      const { data, error } = await supabase
        .from('walk_sessions')
        .select('id, started_at, duration_s, moving_time_s, distance_m, route, pause_points, start_label, end_label, farthest_label')
        .eq('pet_id', petId)
        .eq('validation_verdict', 'valid')
        .order('started_at', { ascending: false })
        .limit(120);
      if (!cancelled && !error) setRows((data ?? []) as GalleryRow[]);
    })();
    // Catch-up award check — walks synced while the app was dead may have
    // crossed a rung nobody celebrated yet.
    if (user?.id) evaluatePawPrints(petId, user.id).catch(() => {});
    return () => { cancelled = true; };
  }, [petId, user?.id]);

  const walks = useMemo(() => (rows ?? []).map(toPawPrintWalk), [rows]);
  const totals = useMemo(() => aggregateWalks(walks), [walks]);
  const nextMilestone = useMemo(() => nextDistanceMilestone(totals), [totals]);
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

      <FlatList
        data={rows ?? []}
        keyExtractor={(r) => r.id}
        numColumns={3}
        columnWrapperStyle={{ gap }}
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
        renderItem={({ item }) => (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => {
              haptic.tap();
              track('pawprint_tile_opened', { walk_session_id: item.id });
              setSharedWalk(item);
            }}
          >
            <WalkTile route={item.route} size={tileSize} />
          </TouchableOpacity>
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
          pausePoints={sharedWalk.pause_points ?? []}
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
