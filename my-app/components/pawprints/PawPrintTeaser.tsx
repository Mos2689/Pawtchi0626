import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { color, font, radius, space } from '../../constants/design';
import { useWalkEnabled } from '../../hooks/useWalkEnabled';
import { supabase } from '../../lib/supabase';
import { track } from '../../lib/analytics';
import { buildMonthlyRecap, PawPrintWalk, previousMonthKey } from '../../lib/pawPrints';
import { useActivePetStore } from '../../store/useActivePetStore';
import { WalkTile } from './WalkTile';
import type { GeoPoint } from '../../lib/walk/geo';

interface TeaserRow {
  id: string;
  started_at: string;
  distance_m: number;
  route: GeoPoint[] | null;
  start_label: string | null;
  end_label: string | null;
  farthest_label: string | null;
}

const TILE_SIZE = 64;

/**
 * Home-feed entry into the Walk Gallery: the last few walks as tiles, plus a
 * once-per-month headline when a new Paw Print recap is ready. Renders
 * nothing until the archive has at least two drawings — a one-tile "gallery"
 * over-promises.
 */
export function PawPrintTeaser() {
  const router = useRouter();
  const activePet = useActivePetStore((s) => s.activePet);
  const walkEnabled = useWalkEnabled(); // dogs-only feature
  const [rows, setRows] = useState<TeaserRow[] | null>(null);
  const [recapHeadline, setRecapHeadline] = useState<string | null>(null);

  const petId = activePet?.id ?? null;
  const petName = activePet?.name?.trim() || 'your dog';

  useEffect(() => {
    if (!walkEnabled || !petId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('walk_sessions')
        .select('id, started_at, distance_m, route, start_label, end_label, farthest_label')
        .eq('pet_id', petId)
        .eq('validation_verdict', 'valid')
        .order('started_at', { ascending: false })
        .limit(40);
      if (cancelled || error || !data) return;
      const fetched = data as TeaserRow[];
      setRows(fetched);

      // Once-per-month recap headline: previous month built a Paw Print and
      // this device hasn't surfaced it yet.
      const prevKey = previousMonthKey(new Date());
      const walks: PawPrintWalk[] = fetched.map((r) => ({
        id: r.id,
        startedAt: r.started_at,
        distanceM: Number(r.distance_m) || 0,
        durationS: 0,
        sniffCount: 0,
        startLabel: r.start_label,
        endLabel: r.end_label,
        farthestLabel: r.farthest_label,
      }));
      const recap = buildMonthlyRecap(walks, prevKey, petName);
      if (!recap) return;
      const seenKey = `pawprints:recap_seen:${prevKey}`;
      const seen = await AsyncStorage.getItem(seenKey);
      if (!cancelled && !seen) {
        setRecapHeadline(`${recap.monthLabel.charAt(0)}${recap.monthLabel.slice(1).toLowerCase()}'s Paw Print is ready`);
      }
    })();
    return () => { cancelled = true; };
  }, [petId, petName, walkEnabled]);

  if (!walkEnabled || !rows || rows.length < 2) return null;

  const openGallery = async () => {
    track('pawprint_teaser_tapped', { recap_headline: recapHeadline != null });
    if (recapHeadline) {
      setRecapHeadline(null);
      await AsyncStorage.setItem(`pawprints:recap_seen:${previousMonthKey(new Date())}`, '1');
    }
    router.push('/walk-gallery' as never);
  };

  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={openGallery}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>WALK GALLERY</Text>
        <MaterialIcons name="chevron-right" size={20} color={color.slateFaint} />
      </View>
      {recapHeadline && (
        <View style={styles.recapRow}>
          <View style={styles.recapDot} />
          <Text style={styles.recapText}>{recapHeadline}</Text>
        </View>
      )}
      <View style={styles.tilesRow}>
        {rows.slice(0, 4).map((r) => (
          <WalkTile key={r.id} route={r.route} size={TILE_SIZE} />
        ))}
      </View>
      <Text style={styles.caption}>Every walk draws something different.</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.hairline,
    padding: space.lg,
    gap: space.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: 2,
    color: color.slateFaint,
  },
  recapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recapDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: color.yellow,
  },
  recapText: {
    fontFamily: font.bold,
    fontSize: 13.5,
    color: color.ink,
  },
  tilesRow: {
    flexDirection: 'row',
    gap: space.sm,
  },
  caption: {
    fontFamily: font.medium,
    fontSize: 12,
    color: color.slateMuted,
  },
});
