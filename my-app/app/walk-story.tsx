/**
 * /walk-story — full-screen Walk Story viewer.
 *
 * Normal entry points prime a local snapshot before navigation, so the first
 * Story frame paints immediately. The database read below is stale-while-
 * revalidate: it refreshes the next replay without replacing the Story a user
 * is currently watching. Only a genuinely uncached deep link waits for data.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';

import { WALK_CAMERA_ENABLED, WALK_STORY_ENABLED } from '../constants/features';
import { useWalkEnabled } from '../hooks/useWalkEnabled';
import { supabase } from '../lib/supabase';
import { fetchWalkKeepsakes } from '../lib/walk/keepsakeSync';
import { track } from '../lib/analytics';
import { markWalkStorySeen, readPendingWalkStory } from '../lib/walkStorySync';
import {
  buildStoryFromSnapshot,
  createWalkStorySnapshot,
  type WalkStorySnapshot,
} from '../lib/walkStorySnapshot';
import { useAuth } from '../providers/AuthProvider';
import { useActivePetStore } from '../store/useActivePetStore';
import { usePawPrintStore } from '../store/usePawPrintStore';
import {
  latestCachedStoryForPet,
  useWalkStoryStore,
} from '../store/useWalkStoryStore';
import { BreathingPaw } from '../components/BreathingPaw';
import { WalkStoryViewer } from '../components/story/WalkStoryViewer';
import type { StoryContext } from '../components/story/StorySlide';
import { storyColor } from '../components/story/storyTheme';

export default function WalkStoryScreen() {
  const walkEnabled = useWalkEnabled();
  if (!WALK_STORY_ENABLED || !walkEnabled) return <Redirect href="/(tabs)" />;
  return <WalkStoryInner />;
}

function WalkStoryInner() {
  const router = useRouter();
  const { id, source } = useLocalSearchParams<{ id?: string; source?: string }>();
  const { width, height } = useWindowDimensions();
  // The pending-story marker is per account — see lib/walkStorySync.
  const { user } = useAuth();
  const activePet = useActivePetStore((state) => state.activePet);
  const totals = usePawPrintStore((state) => state.totals);
  const snapshots = useWalkStoryStore((state) => state.snapshots);
  const primeSnapshot = useWalkStoryStore((state) => state.prime);

  const requestedId = typeof id === 'string' && id.length > 0 ? id : null;
  const petId = activePet?.id ?? null;
  const cachedCandidate = useMemo(
    () => {
      if (!requestedId) return latestCachedStoryForPet(snapshots, petId);
      const candidate = snapshots[requestedId] ?? null;
      return candidate?.petId === petId ? candidate : null;
    },
    [petId, requestedId, snapshots],
  );

  const [phase, setPhase] = useState<'loading' | 'ready' | 'empty'>(
    cachedCandidate ? 'ready' : 'loading',
  );
  const [displaySnapshot, setDisplaySnapshot] =
    useState<WalkStorySnapshot | null>(cachedCandidate);
  const displaySnapshotRef = useRef(displaySnapshot);
  const trackedStoryRef = useRef<string | null>(null);

  useEffect(() => {
    displaySnapshotRef.current = displaySnapshot;
  }, [displaySnapshot]);

  // Persisted Zustand hydration can finish just after this screen mounts.
  // Adopt that snapshot immediately instead of waiting for network refresh.
  useEffect(() => {
    if (!displaySnapshot && cachedCandidate) {
      displaySnapshotRef.current = cachedCandidate;
      setDisplaySnapshot(cachedCandidate);
      setPhase('ready');
    }
  }, [cachedCandidate, displaySnapshot]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!petId) {
        if (!displaySnapshotRef.current) setPhase('empty');
        return;
      }

      let walkId = requestedId;
      if (!walkId) {
        const pending = await readPendingWalkStory(user?.id);
        walkId = pending?.petId === petId ? pending.walkSessionId : null;
      }

      const columns =
        'id, started_at, duration_s, moving_time_s, distance_m, avg_speed_kmh, route, pause_points, sniff_points, start_label, end_label, farthest_label, weather';
      const base = supabase
        .from('walk_sessions')
        .select(columns)
        .eq('pet_id', petId)
        .neq('validation_verdict', 'likely_vehicle');
      const { data: row, error } = walkId
        ? await base.eq('id', walkId).maybeSingle()
        : await base.order('started_at', { ascending: false }).limit(1).maybeSingle();

      if (cancelled) return;
      if (error || !row) {
        if (!displaySnapshotRef.current) setPhase('empty');
        return;
      }

      // Fetched separately rather than joined: keepsakes sync after the walk
      // saves, so this is the first point at which they are reliably there.
      // An empty result is the normal case and costs the story nothing.
      const keepsakeRows = WALK_CAMERA_ENABLED ? await fetchWalkKeepsakes(row.id) : [];
      if (cancelled) return;

      const snapshot = createWalkStorySnapshot({
        walkSessionId: row.id,
        petId,
        keepsakes: keepsakeRows,
        petName: activePet?.name,
        petGender: activePet?.gender,
        breed: activePet?.breed,
        ageYears: activePet?.age_years,
        startedAt: row.started_at,
        durationS: row.duration_s,
        movingTimeS: row.moving_time_s,
        distanceM: row.distance_m,
        avgSpeedKmh: row.avg_speed_kmh,
        route: row.route,
        pausePoints: row.pause_points,
        sniffPoints: row.sniff_points,
        startLabel: row.start_label,
        endLabel: row.end_label,
        farthestLabel: row.farthest_label,
        weather: row.weather,
        totals,
      });
      if (!snapshot) {
        if (!displaySnapshotRef.current) setPhase('empty');
        return;
      }

      // Cache the refreshed row for the next replay. Do not mutate the beats
      // under a viewer that is already progressing through its current copy.
      primeSnapshot(snapshot);

      // ...with one exception. A snapshot primed at walk end can be missing its
      // moments entirely: the rows and thumbnails are still uploading when the
      // summary hands over. Adding a whole beat mid-view is normally the churn
      // this branch exists to prevent, but a story that silently omits the
      // photos someone just took is the worse outcome by a distance — and it
      // only ever fires on the first viewing of a brand-new walk, because after
      // that both copies have them.
      const current = displaySnapshotRef.current;
      const gainedKeepsakes =
        (current?.keepsakes?.length ?? 0) === 0 && (snapshot.keepsakes?.length ?? 0) > 0;

      if (!current || gainedKeepsakes) {
        displaySnapshotRef.current = snapshot;
        setDisplaySnapshot(snapshot);
        setPhase('ready');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activePet, petId, primeSnapshot, requestedId, totals, user?.id]);

  const built = useMemo(() => {
    if (!displaySnapshot) return null;
    const story = buildStoryFromSnapshot(displaySnapshot);
    const ctx: StoryContext = {
      petName: displaySnapshot.petName ?? '',
      petGender: displaySnapshot.petGender,
      startedAt: displaySnapshot.startedAt,
      route: displaySnapshot.route,
      sniffStops: displaySnapshot.sniffStops,
      labels: displaySnapshot.labels,
      stats: displaySnapshot.stats,
      sessionId: displaySnapshot.walkSessionId,
      slideW: width,
      slideH: height,
      walkNumber: displaySnapshot.totals?.walkCount ?? null,
      breedLine: displaySnapshot.breedLine,
    };
    return { story, ctx };
  }, [displaySnapshot, height, width]);

  useEffect(() => {
    if (!built || !displaySnapshot) return;
    if (trackedStoryRef.current === displaySnapshot.walkSessionId) return;
    trackedStoryRef.current = displaySnapshot.walkSessionId;
    track('walk_story_opened', {
      beats: built.story.beats.length,
      source: source ?? (requestedId ? 'deeplink' : 'ring'),
      cache_hit: Boolean(cachedCandidate),
    });
    markWalkStorySeen(user?.id);
  }, [built, cachedCandidate, displaySnapshot, requestedId, source, user?.id]);

  const onClose = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  if (phase === 'empty') return <Redirect href="/(tabs)" />;

  if (phase === 'loading' || !built) {
    return (
      <View style={styles.loading}>
        <BreathingPaw size={28} workingColor={storyColor.route} />
      </View>
    );
  }

  return (
    <WalkStoryViewer
      story={built.story}
      ctx={built.ctx}
      onClose={onClose}
    />
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: storyColor.canvas,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
