/**
 * Home — map-first.
 *
 * The map is the screen. It runs edge to edge and is never covered: every
 * control floats on it as its own rounded, elevated object. Browsing your walks
 * IS moving the map — the rail snaps, and whichever card settles in view tells
 * the camera where to look, so content and geography are one control rather
 * than two stacked layers competing for the same space.
 *
 * There is deliberately no scroll and no bottom sheet. Everything Home shows
 * fits in the rail; anything longer lives behind the gallery button, because a
 * list that grows forever is a different screen, not a taller one.
 *
 * Cats keep a plain, mapless layout — walks are dogs-only, and a map with
 * nothing on it is worse than no map.
 */

import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import Reanimated from 'react-native-reanimated';

import { color, font, space } from '../../constants/design';
import { entrance } from '../../components/motionPresets';

import { useActivePetStore } from '../../store/useActivePetStore';
import { usePawPrintStore } from '../../store/usePawPrintStore';
import { useStreakStore } from '../../store/useStreakStore';
import { useWalkStoryStore } from '../../store/useWalkStoryStore';
import { usePetContextStore } from '../../store/usePetContextStore';
import { resolvePetImage } from '../../lib/petFallbackImage';
import { useAuth } from '../../providers/AuthProvider';
import { useSubscription } from '../../hooks/useSubscription';
import { useRecentWalks } from '../../hooks/useRecentWalks';
import { track } from '../../lib/analytics';
import { useWalkEnabled } from '../../hooks/useWalkEnabled';
import {
  SPOTS_OSM_MVP_ENABLED,
  WALK_CAMERA_ENABLED,
  WALK_STORY_ENABLED,
} from '../../constants/features';
import { useKeepsakePins } from '../../hooks/useKeepsakePins';
import { useNearbySpots } from '../../hooks/useNearbySpots';
import { applyFilter, availableFilters, type SpotFilter } from '../../lib/spots/filters';
import { shouldOfferAreaSearch } from '../../lib/spots/areaSearch';
import { buildVisitIndex, type VisitIndex } from '../../lib/spots/visited';
import { useWalkedRoutes } from '../../hooks/useWalkedRoutes';
import type { GeoPoint } from '../../lib/walk/geo';
import type { MapCamera } from '../../lib/walk/mapCamera';
import { copy, displayName, distanceBucket } from '../../lib/spots/copy';
import type { SpotsStatus } from '../../lib/spots/fetchPolicy';
import type { PawtchiSpot } from '../../lib/spots/types';
import { SpotFilterRail } from '../../components/spots/SpotFilterRail';
import { SpotDetailsSheet } from '../../components/spots/SpotDetailsSheet';
import { OsmAttribution } from '../../components/spots/OsmAttribution';
import { CATEGORY_ICON, CATEGORY_TONE } from '../../components/spots/spotVisuals';
import { armWalkStart } from '../../lib/walk/walkStartIntent';
import { prefetchWalkingRoute } from '../../lib/walk/routeClient';
import { isWalkToSpot } from '../../lib/spots/spotAction';
import { useSpotRoutePreview } from '../../hooks/useSpotRoutePreview';
import { deriveDogWalkProfile } from '../../lib/walk/dogCalibration';
import { describeWay, dogPaceKmh } from '../../lib/walk/wayfinding';
import { WalksignMomentModal } from '../../components/walksign/WalksignMomentModal';
import { MilestoneCelebration } from '../../components/pawprints/MilestoneCelebration';
import { TemplateUnlockCelebration } from '../../components/moments/TemplateUnlockCelebration';
import { HomeMapLayer } from '../../components/home/HomeMapLayer';
import { HomeTopBar } from '../../components/home/HomeTopBar';
import { HomeRail, type RailEntry } from '../../components/home/HomeRail';
import { MapControls } from '../../components/home/MapControls';
import { MapLocationPrompt } from '../../components/home/MapLocationPrompt';
import { TAB_BAR_CLEARANCE } from '../../components/navigation/SplitTabBar';
import { useHomeMapCenter } from '../../hooks/useHomeMapCenter';
import { useCurrentWalkWeather } from '../../hooks/useCurrentWalkWeather';
import {
  buildSniffItems,
  buildSniffPins,
  buildTodayTotals,
  buildWalkItems,
  buildWalkPins,
  formatDwell,
  sniffsForWalk,
  walkFeedLoadingCopy,
  type RailSegment,
} from '../../lib/home/homeRail';
import {
  clearPendingWalksignCelebration,
  readPendingWalksignCelebration,
  type PendingWalksignCelebration,
} from '../../lib/walksign/walksignSync';
import { createWalkStorySnapshot } from '../../lib/walkStorySnapshot';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../lib/supabase';
import { useNotificationPermission } from '../../hooks/useNotificationPermission';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import { NotificationBell } from '../../components/notifications/NotificationBell';
import {
  selectHasUrgentUnread,
  selectUnreadCount,
  useNotificationCenterStore,
} from '../../store/useNotificationCenterStore';
import { NotificationPrimer } from '../../components/NotificationPrimer';
import { FirstWalkIntroVideo } from '../../components/FirstWalkIntroVideo';
import { useFirstWalkIntro } from '../../hooks/useFirstWalkIntro';
import { useWalkStore } from '../../store/useWalkStore';

/**
 * Cooldown between value-moment asks, so a decline is never a nag.
 *
 * Keyed per user. A global key meant the next account on this device inherited
 * the previous owner's 14-day cooldown and was never offered notifications at
 * all — the same class of leak as the notification center's read state.
 */
const primerCooldownKey = (userId: string | null | undefined) =>
  `notification_primer_last_shown:${userId ?? 'anon'}`;

/**
 * The Spots rail: either places, or one card explaining why there are none.
 *
 * Every non-ready state renders as a rail card rather than as an overlay, so
 * the map is never covered to deliver bad news. An error screen that replaced
 * the surface would also throw away the map, which is still perfectly useful
 * for looking at where you are.
 */
function buildSpotEntries(input: {
  spots: PawtchiSpot[];
  status: SpotsStatus;
  canExpand: boolean;
  /** Spot id → walks that came through it. Absent means never. */
  visits: VisitIndex;
  onExpand: () => void;
  onRetry: () => void;
  onAllowLocation: () => void;
}): RailEntry[] {
  const { spots, status, canExpand, visits, onExpand, onRetry, onAllowLocation } = input;

  if (spots.length > 0) {
    return spots.map(spot => ({
      kind: 'nearby' as const,
      id: spot.id,
      item: spot,
      visits: visits[spot.id],
    }));
  }

  switch (status) {
    case 'loading':
      // The breathing card plus two ghosts of the cards about to replace them.
      // A single static "Finding spots nearby" read as a dead end — nothing
      // moved, so there was no way to tell working from stuck.
      return [
        {
          kind: 'loading',
          id: 'spots-loading',
          title: copy.loading,
          lines: [...copy.loadingLines],
          slowLine: copy.loadingSlow,
          tone: 'spot',
        },
        { kind: 'ghost', id: 'spots-ghost-0', index: 0 },
        { kind: 'ghost', id: 'spots-ghost-1', index: 1 },
      ];
    case 'needs_location':
      return [
        {
          kind: 'message',
          id: 'spots-location',
          title: copy.locationNeeded.title,
          body: copy.locationNeeded.body,
          action: copy.locationNeeded.action,
          onAction: onAllowLocation,
        },
      ];
    case 'error':
      return [
        {
          kind: 'message',
          id: 'spots-error',
          title: copy.error.title,
          body: copy.error.body,
          action: copy.error.action,
          onAction: onRetry,
        },
      ];
    case 'empty':
    case 'stale':
    case 'ready':
      return [
        {
          kind: 'message',
          id: 'spots-empty',
          title: copy.empty.title,
          body: copy.empty.body,
          // Only offer to widen when there is somewhere wider to go. An action
          // that silently does nothing is worse than no action.
          action: canExpand ? copy.empty.action : undefined,
          onAction: canExpand ? onExpand : undefined,
        },
      ];
    default:
      return [];
  }
}

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const activePet = useActivePetStore(s => s.activePet);
  // Walks are dogs-only — every walk surface below hides for a cat profile.
  const walkEnabled = useWalkEnabled();
  const currentStreak = useStreakStore(s => s.currentStreak);
  const fetchStreak = useStreakStore(s => s.fetchStreak);

  // ── Notification reach ────────────────────────────────────────────────────
  // 148 of 161 onboarded owners have no push token, and until now none of them
  // had any route to being asked: the primer only ever mounted at the end of
  // onboarding, which they had all already passed. These two surfaces are that
  // route — a header chip while they are unreachable, and one primer shown at a
  // moment when the app has already demonstrated it is worth hearing from.
  const notifPermission = useNotificationPermission();
  const { requestPermission: requestNotificationPermission } = usePushNotifications();
  const [homePrimerVisible, setHomePrimerVisible] = React.useState(false);
  const primerConsidered = React.useRef(false);

  const refreshNotifPermission = notifPermission.refresh;
  useFocusEffect(
    React.useCallback(() => {
      void refreshNotifPermission();
    }, [refreshNotifPermission]),
  );
  const { user } = useAuth();
  const {
    isFreemiumActive,
    daysSinceCreation,
    // Mirrored into the notification center, which cannot read a React context
    // from a Zustand store — see setSubscriptionSnapshot below.
    status: subStatus,
    daysLeft: subDaysLeft,
  } = useSubscription();
  const { walks: recentWalks, loading: walksLoading } = useRecentWalks(activePet?.id, 7);
  const storyTotals = usePawPrintStore(s => s.totals);
  const primeWalkStory = useWalkStoryStore(s => s.prime);
  const injectSubscriptionData = usePetContextStore(s => s.injectSubscriptionData);

  const petName = activePet?.name || 'Buddy';

  // ── The rail ──────────────────────────────────────────────────────────────
  const [segment, setSegment] = React.useState<RailSegment>('walks');
  const walkItems = useMemo(
    () => (walkEnabled ? buildWalkItems(recentWalks, activePet?.name) : []),
    [walkEnabled, recentWalks, activePet?.name],
  );
  const sniffItems = useMemo(
    () => (walkEnabled ? buildSniffItems(recentWalks, activePet?.name) : []),
    [walkEnabled, recentWalks, activePet?.name],
  );
  const todayTotals = useMemo(() => buildTodayTotals(recentWalks), [recentWalks]);

  // Resolved before Spots, because Spots reads this coordinate rather than
  // asking for one of its own. That is the whole of Spots' relationship with
  // location: it borrows an already-cached fix and never touches the GPS.
  const {
    center: mapCenter,
    resolving: mapResolving,
    canAskLocation,
    needsDisclosure: locationNeedsDisclosure,
    requestLocation,
  } = useHomeMapCenter(activePet?.id, user?.id, walkEnabled);
  const currentWeather = useCurrentWalkWeather(mapCenter, walkEnabled);

  // ── Spots: nearby places, not walk history ───────────────────────────────
  // Everything below is behind SPOTS_OSM_MVP_ENABLED. With the flag off the
  // hook is disabled, the segment does not render, and Home is byte-for-byte
  // what it was before this feature.
  const spotsEnabled = SPOTS_OSM_MVP_ENABLED && walkEnabled;
  const [spotFilter, setSpotFilter] = React.useState<SpotFilter>('all');
  const [openSpot, setOpenSpot] = React.useState<PawtchiSpot | null>(null);

  /**
   * Where the map is pointing, as opposed to where the owner is.
   *
   * The map pans now, so these are two different facts and conflating them is
   * how you end up measuring distances from someone's house to a park they are
   * looking at three suburbs away. `viewCenter` is only ever used to decide
   * whether to OFFER a new search — it never triggers one.
   */
  const [viewCenter, setViewCenter] = React.useState<GeoPoint | null>(null);

  /**
   * The coordinate the spots on screen were actually fetched for.
   *
   * Null until the owner asks about somewhere other than where they are, at
   * which point it takes over from Home's own centre. Kept as its own piece of
   * state rather than derived from `viewCenter` so that panning the map is
   * free: nothing is queried until it is asked for.
   */
  const [searchCenter, setSearchCenter] = React.useState<GeoPoint | null>(null);
  const spotsCenter = searchCenter ?? mapCenter;

  const onViewCameraChange = useCallback((next: MapCamera) => {
    setViewCenter(prev =>
      prev && prev.lat === next.center.lat && prev.lng === next.center.lng
        ? prev
        : next.center,
    );
  }, []);

  const {
    spots: allSpots,
    status: spotsStatus,
    cacheStatus: spotsCacheStatus,
    radiusMeters: spotsRadius,
    canExpand: canExpandSpots,
    refresh: refreshSpots,
    expand: expandSpots,
  } = useNearbySpots({
    // Only fetches while the segment is actually being looked at. Switching
    // away does not cancel a request in flight — it will populate the shared
    // cache for the next person regardless — but it never starts a new one.
    enabled: spotsEnabled && segment === 'spots',
    center: spotsCenter,
    canAskLocation,
  });

  /**
   * Which way the open spot is, and roughly how long at this dog's pace.
   *
   * Measured from `mapCenter` — the OWNER's position — and only when
   * `searchCenter` is null. Once someone searches another area, `distanceMeters`
   * on each spot is measured from there instead, and a heading from the owner
   * paired with a distance from a suburb three away would be two answers to one
   * question. In that case the sheet gets nothing and shows nothing.
   */
  /**
   * The way to the open spot, drawn before anything starts.
   *
   * Only for places you walk a dog TO — a vet or a pet shop hands off to a maps
   * app instead, so previewing one would spend a request on donated
   * infrastructure for a route nobody is going to walk. See lib/spots/spotAction.ts.
   */
  const previewDestination = useMemo(
    () =>
      openSpot && isWalkToSpot(openSpot.category)
        ? { lat: openSpot.latitude, lng: openSpot.longitude }
        : null,
    [openSpot],
  );
  const spotPreview = useSpotRoutePreview({
    origin: mapCenter,
    destination: previewDestination,
  });

  /**
   * How much of the screen the preview sheet covers, as measured by the sheet.
   *
   * The camera frames the route above this. Reported rather than assumed: the
   * sheet's height depends on how much the place knows about itself, and a
   * constant here would be right for a beach and wrong for a vet with hours,
   * an address and a phone number.
   */
  const [previewSheetHeight, setPreviewSheetHeight] = React.useState(0);
  const previewSheetInset = previewDestination ? previewSheetHeight : 0;

  /**
   * The floating chrome the route must stay clear of at the top.
   *
   * The pet header and the Spots filter chips sit ON the map, so the usable
   * canvas starts below them. A constant rather than a measurement because
   * unlike the sheet — whose height depends on how much a place knows about
   * itself — this stack is the same on every spot: one header row, one chip
   * row, and the gap between them.
   */
  const SPOTS_TOP_CHROME = 104;
  const previewTopInset = previewDestination ? insets.top + SPOTS_TOP_CHROME : 0;

  const openSpotWay = useMemo(() => {
    if (!openSpot || searchCenter) return null;
    const profile = deriveDogWalkProfile({
      species: activePet?.species ?? 'dog',
      breed: activePet?.breed ?? null,
      ageYears: activePet?.age_years ?? null,
      weightKg: activePet?.current_weight_kg ?? null,
      medicalConditions: activePet?.medical_conditions ?? null,
    });
    return describeWay(
      mapCenter,
      { lat: openSpot.latitude, lng: openSpot.longitude },
      // The routed distance once it lands, the straight line until then. This
      // is the ETA's whole accuracy story: walkEtaMinutes only ever divided
      // distance by pace, so handing it the real walking distance turns a
      // known-optimistic guess into an estimate worth planning around.
      spotPreview.distanceM ?? openSpot.distanceMeters,
      dogPaceKmh(profile.paceBandKmh),
    );
  }, [activePet, mapCenter, openSpot, searchCenter, spotPreview.distanceM]);

  const spots = useMemo(() => applyFilter(allSpots, spotFilter), [allSpots, spotFilter]);
  const spotFilters = useMemo(() => availableFilters(allSpots), [allSpots]);

  /**
   * Which of these places this dog has actually been to.
   *
   * The one thing here that is not crowd-sourced. Built over ALL spots rather
   * than the filtered set so switching a chip never recomputes it, and only
   * while Spots is on screen — someone who never opens the segment never pays
   * for the history query.
   */
  const walkedRoutes = useWalkedRoutes(activePet?.id, spotsEnabled && segment === 'spots');
  const spotVisits = useMemo(
    () => buildVisitIndex(allSpots, walkedRoutes),
    [allSpots, walkedRoutes],
  );

  // Offered, not permanent: only once the view has travelled far enough that
  // the results on screen have stopped describing it (lib/spots/areaSearch.ts).
  const canSearchArea =
    segment === 'spots' &&
    shouldOfferAreaSearch({
      viewCenter,
      searchedCenter: spotsCenter,
      radiusMeters: spotsRadius,
    });

  // Reported once per resolved outcome, not per render. `cache_status` is the
  // operational number that matters: upstream_fetch per active user is our load
  // on volunteer infrastructure, and it has to stay small as usage grows.
  const reportedSpotsFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (spotsStatus !== 'ready' && spotsStatus !== 'stale' && spotsStatus !== 'empty') return;
    const signature = `${spotsStatus}:${spotsRadius}:${allSpots.length}:${spotsCacheStatus}`;
    if (reportedSpotsFor.current === signature) return;
    reportedSpotsFor.current = signature;

    track('spots_results_loaded', {
      results_count: allSpots.length,
      search_radius_m: spotsRadius,
      cache_status: spotsCacheStatus,
    });
    // The honest coverage signal. A high rate in a target market is the trigger
    // to supplement OSM with another provider — not a query bug to chase.
    if (allSpots.length === 0) {
      track('spots_empty_state_viewed', { search_radius_m: spotsRadius });
    }
  }, [spotsStatus, allSpots.length, spotsRadius, spotsCacheStatus]);

  const entries: RailEntry[] = useMemo(() => {
    if (!walkEnabled) return [];
    if (segment === 'spots') {
      return buildSpotEntries({
        spots,
        status: spotsStatus,
        canExpand: canExpandSpots,
        visits: spotVisits,
        onExpand: expandSpots,
        onRetry: refreshSpots,
        onAllowLocation: requestLocation,
      });
    }
    // Nothing to show AND still working is not the same fact as "no walks yet",
    // and the empty card states the second one outright. Rendering it here told
    // owners with months of history that they had never walked their dog, for
    // as long as the query took. The feed is cached now so this is a first-run
    // path rather than an every-launch one — but on that first run it must
    // still promise cards rather than deny them.
    if (walkItems.length === 0 && walksLoading) {
      return [
        {
          kind: 'loading' as const,
          id: 'walks-loading',
          title: walkFeedLoadingCopy.title,
          lines: [...walkFeedLoadingCopy.lines],
          slowLine: walkFeedLoadingCopy.slowLine,
          tone: 'walk' as const,
        },
        { kind: 'ghost' as const, id: 'walks-ghost-0', index: 0 },
        { kind: 'ghost' as const, id: 'walks-ghost-1', index: 1 },
      ];
    }

    const walks: RailEntry[] = walkItems.map(item => ({
      kind: 'walk' as const,
      id: item.id,
      item,
    }));
    return [
      walkItems.length > 0
        ? { kind: 'today' as const, id: 'today', totals: todayTotals, weather: currentWeather }
        : { kind: 'empty' as const, id: 'empty', petName },
      ...walks,
    ];
  }, [
    walkEnabled,
    segment,
    walkItems,
    walksLoading,
    todayTotals,
    currentWeather,
    petName,
    // The Spots inputs are real dependencies: without them the rail would keep
    // rendering the "finding spots" card after the results had already arrived.
    spots,
    spotsStatus,
    canExpandSpots,
    spotVisits,
    expandSpots,
    refreshSpots,
    requestLocation,
  ]);

  // What the map is pointing at. Null means "no card in particular" — the
  // bookend cards have no geography, so they leave the map where it was rather
  // than yanking it somewhere arbitrary.
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  // Before anyone swipes, the newest item is what the map is showing — so it is
  // what the map should be labelling. Without this the screen opens with a
  // framed route and no pin on it, which reads as a bug rather than a default.
  const activeId = useMemo(() => {
    if (selectedId) return selectedId;
    if (segment === 'spots') return spots[0]?.id ?? null;
    return walkItems[0]?.id ?? null;
  }, [selectedId, segment, walkItems, spots]);

  const selectedRoute = useMemo(() => {
    if (segment === 'spots') {
      // With a place open and its way resolved, the drawn route IS the framing:
      // one line from the owner to the pin, which the camera then fits. This is
      // the preview the owner is deciding on, so it outranks the bare point.
      if (spotPreview.route && spotPreview.route.length > 1) return spotPreview.route;
      // A spot has no route, only a place. Framing the single point is what
      // moves the camera to it — the same mechanism a one-fix walk uses.
      const spot = spots.find(s => s.id === activeId);
      return spot ? [{ lat: spot.latitude, lng: spot.longitude }] : null;
    }
    return walkItems.find(w => w.id === selectedId)?.route ?? walkItems[0]?.route ?? null;
  }, [segment, selectedId, activeId, walkItems, spots, spotPreview.route]);

  /**
   * The sniff stop whose dwell is currently being shown.
   *
   * Separate from `selectedId` on purpose: that one drives the rail and the
   * camera, and a sniff must not do either. Tapping a stop is a small aside —
   * "two minutes here" — not a change of subject.
   */
  const [openSniffId, setOpenSniffId] = React.useState<string | null>(null);

  /**
   * The photographs belonging to the walk currently drawn.
   *
   * Same subject as `walkSniffs`: whatever the rail has selected. Photos from
   * other walks would be scattered over a route they did not happen on.
   */
  const keepsakePins = useKeepsakePins(
    WALK_CAMERA_ENABLED && segment === 'walks' ? activeId : null,
  );

  /**
   * Walk facts for captioning an opened photo.
   *
   * The place comes from the selected walk's own title, so a moment is
   * described by where that walk happened rather than by where the dog lives.
   */
  const keepsakeContext = useMemo(
    () => ({
      petId: activePet?.id ?? null,
      petName: activePet?.name ?? null,
      placeLabel: walkItems.find(w => w.id === activeId)?.title ?? null,
      weather: null,
    }),
    [activePet?.id, activePet?.name, walkItems, activeId],
  );

  /** The stops belonging to the walk currently drawn. */
  const walkSniffs = useMemo(
    () => (segment === 'walks' ? sniffsForWalk(sniffItems, activeId) : []),
    [segment, sniffItems, activeId],
  );

  const onRailSelect = useCallback(
    (entry: RailEntry) => {
      // A new walk means new stops — drop whichever dwell was open.
      if (entry.kind === 'walk') {
        setSelectedId(entry.id);
        setOpenSniffId(null);
      } else if (entry.kind === 'nearby') {
        setSelectedId(entry.id);
        track('spot_marker_viewed', {
          spot_category: entry.item.category,
          provider: entry.item.provider,
          dog_access_status: entry.item.dogAccess,
          distance_bucket: distanceBucket(entry.item.distanceMeters),
          source_screen: 'rail',
        });
      }
    },
    [],
  );

  /**
   * Tapping a pin.
   *
   * A spot pin selects it, which moves the rail and the camera — the same
   * selection the rail makes, so the two controls stay one state.
   *
   * A sniff pin does neither. It toggles its own dwell label and nothing else:
   * the route stays drawn, the rail stays where it is, the camera does not
   * move. Yanking the map to a stop you can already see would be motion for
   * its own sake, and would throw away the route the stop belongs to — which
   * is the entire reason these are here rather than in a tab.
   */
  const onMarkerPress = useCallback(
    (id: string) => {
      if (segment === 'walks') {
        if (walkSniffs.some(s => s.id === id)) {
          setOpenSniffId(current => (current === id ? null : id));
          return;
        }
        setOpenSniffId(null);
      }
      setSelectedId(id);
    },
    [segment, walkSniffs],
  );

  const onOpenSpot = useCallback((spot: PawtchiSpot) => {
    setOpenSpot(spot);
    // Selection follows the tap, not just the scroll.
    //
    // The rail selects on momentum-end, so a card tapped while it sits off
    // centre opens a place the map has not highlighted. That was survivable
    // when opening a spot only raised a sheet; now it draws a route, and a line
    // leading to a pale pin while a different one is inked reads as a bug. The
    // rail is uncontrolled, so this moves nothing on screen — it only makes the
    // pin agree with the sheet.
    setSelectedId(spot.id);
    track('spot_details_opened', {
      spot_category: spot.category,
      provider: spot.provider,
      dog_access_status: spot.dogAccess,
      distance_bucket: distanceBucket(spot.distanceMeters),
    });
  }, []);

  /**
   * Back to the default view.
   *
   * Undoes both ways the screen can have wandered: a rail selection, and a
   * search the owner ran somewhere other than where they are. Clearing
   * `searchCenter` hands the query back to Home's own coordinate, and the
   * results for it are already cached, so returning costs nothing.
   */
  const onRecentre = useCallback(() => {
    setSelectedId(null);
    setSearchCenter(null);
    setViewCenter(null);
  }, []);

  const onSearchArea = useCallback(() => {
    if (!viewCenter) return;
    // Moving the searched centre is what re-runs the hook's resolve pass; there
    // is no separate "go" call, and a cell we have already asked about answers
    // from cache rather than costing another upstream request.
    setSearchCenter(viewCenter);
    // The spot that was selected may not be in the new answer at all, and a
    // selection pointing at nothing strands the rail and the label.
    setSelectedId(null);
    track('spots_search_area_requested', {
      search_radius_m: spotsRadius,
      source_screen: 'moved_map',
    });
  }, [viewCenter, spotsRadius]);

  // Reset the pointer when the segment changes — a walk id means nothing in the
  // sniffs list, and leaving it set would strand the map on the wrong pin.
  const onSegmentChange = useCallback((next: RailSegment) => {
    setSegment(next);
    setSelectedId(null);
    setOpenSniffId(null);
    if (next === 'spots') track('spots_tab_opened', {});
  }, []);

  // Pins, with a name on the selected one. Only the selected marker carries a
  // label — a map with every pin shouting its place name is a legend, not a
  // picture, and the rail already says what the others are.
  const markers = useMemo(() => {
    // Spot pins are built from a different source and carry a category glyph
    // and a category colour, so they do not go through buildMapPins at all.
    if (segment === 'spots') {
      const spotPins = spots.map(spot => ({
        id: spot.id,
        lat: spot.latitude,
        lng: spot.longitude,
        origin: mapCenter ?? undefined,
        tone: spot.id === activeId ? ('ink' as const) : CATEGORY_TONE[spot.category],
        icon: CATEGORY_ICON[spot.category],
        label: spot.id === activeId ? displayName(spot.name, spot.category) : null,
      }));

      /**
       * Where the line starts.
       *
       * The destination end has always been marked — it is a spot, and spots
       * get pins. The other end simply stopped in the street, so a drawn route
       * read as a line that came from nowhere. This is the "you are here" the
       * route needs to be a journey rather than a shape.
       *
       * Taken from the route's own first point rather than from `mapCenter`:
       * OSRM snaps the origin to the nearest footpath, sometimes a house away,
       * and a dot floating off the end of its own line is worse than no dot.
       */
      const start = spotPreview.route?.[0];
      return start
        ? [
            ...spotPins,
            {
              id: 'route-origin',
              lat: start.lat,
              lng: start.lng,
              tone: 'ink' as const,
              icon: 'circle-slice-8' as const,
              label: null,
            },
          ]
        : spotPins;
    }
    // One pin per walk, at its start, with the selected one in ink.
    const walkPins = buildWalkPins(walkItems, activeId).map(pin => ({
      ...pin,
      label:
        pin.tone === 'ink' ? walkItems.find(w => w.id === pin.id)?.title ?? null : null,
    }));

    // …and the selected walk's stops, dropped along the route it just drew.
    // Only the tapped one is labelled — every stop shouting "1m 40s" would
    // bury the route under its own annotations.
    const sniffPins = buildSniffPins(walkSniffs, openSniffId).map(pin => ({
      ...pin,
      label:
        pin.id === openSniffId
          ? `${formatDwell(walkSniffs.find(s => s.id === pin.id)?.dwellS ?? 0)} here`
          : null,
    }));

    // Sniffs last so they draw ON the route rather than under a walk-start pin.
    return [...walkPins, ...sniffPins];
  }, [segment, walkItems, walkSniffs, openSniffId, spots, activeId, mapCenter, spotPreview.route]);

  const [locationPromptDismissed, setLocationPromptDismissed] = React.useState(false);
  const showLocationPrompt =
    walkEnabled && canAskLocation && !mapCenter && !locationPromptDismissed;

  const onMapSurface = useCallback((surface: 'map' | 'ground') => {
    track('home_canopy_map_shown', { surface });
  }, []);

  React.useEffect(() => {
    injectSubscriptionData(isFreemiumActive, daysSinceCreation);
  }, [isFreemiumActive, daysSinceCreation, injectSubscriptionData]);

  const todayCalories = usePetContextStore(s => s.todayCalories);
  const refreshToday = usePetContextStore(s => s.refreshToday);

  useFocusEffect(useCallback(() => {
    if (activePet?.id) refreshToday(activePet.id);
  }, [activePet?.id, refreshToday]));

  useFocusEffect(useCallback(() => {
    if (user?.id) fetchStreak(user.id);
  }, [user?.id, fetchStreak]));

  // ── The notification center ───────────────────────────────────────────────
  // Home owns the bell, so Home is what keeps the feed current. Rebuilt on
  // focus rather than on an interval: everything it derives from (today's
  // totals, the pet record, the streak) has just been refreshed by the effects
  // above, so this is the first moment the answer can have changed.
  const unreadCount = useNotificationCenterStore(selectUnreadCount);
  const urgentUnread = useNotificationCenterStore(selectHasUrgentUnread);
  const rebuildNotifications = useNotificationCenterStore(s => s.rebuild);
  const hydrateNotifications = useNotificationCenterStore(s => s.hydrate);
  const setSubscriptionSnapshot = useNotificationCenterStore(s => s.setSubscriptionSnapshot);

  // Binds the centre's read/dismiss state to whoever is signed in. Runs before
  // the rebuild below, so a fresh account never renders against the previous
  // owner's storage even for one frame.
  React.useEffect(() => {
    void hydrateNotifications(user?.id ?? null);
  }, [user?.id, hydrateNotifications]);

  React.useEffect(() => {
    setSubscriptionSnapshot({ status: subStatus ?? null, daysLeft: subDaysLeft ?? null });
  }, [subStatus, subDaysLeft, setSubscriptionSnapshot]);

  // Two triggers, deliberately separate. Focus catches "the owner came back";
  // the data effect catches "something changed while they were already here"
  // (a meal logged on Meal, a pet switched). Folding the second into the first
  // by listing its values as focus-effect deps only looks equivalent — the
  // callback never reads them, so it is a re-subscribe pretending to be a
  // dependency.
  useFocusEffect(useCallback(() => {
    void rebuildNotifications();
  }, [rebuildNotifications]));

  React.useEffect(() => {
    void rebuildNotifications();
  }, [rebuildNotifications, todayCalories, activePet?.id]);

  const [walksignMoment, setWalksignMoment] = React.useState<PendingWalksignCelebration | null>(null);
  useFocusEffect(useCallback(() => {
    if (!activePet?.id) return;
    readPendingWalksignCelebration(user?.id).then(pending => {
      if (pending && pending.petId === activePet.id) setWalksignMoment(pending);
    }).catch(() => {});
  }, [activePet?.id, user?.id]));
  const dismissWalksignMoment = useCallback(() => {
    setWalksignMoment(null);
    clearPendingWalksignCelebration(user?.id);
  }, [user?.id]);

  // Walk Story ring on the avatar — a walk from the last 24h keeps it lit with
  // a story to replay; otherwise it is a calm "take a walk" nudge.
  const storyRingEnabled = WALK_STORY_ENABLED && walkEnabled;
  const STORY_WINDOW_MS = 24 * 60 * 60 * 1000;
  const latestWalkAt = recentWalks[0]?.started_at;
  const hasFreshStory =
    storyRingEnabled &&
    !!latestWalkAt &&
    Date.now() - new Date(latestWalkAt).getTime() < STORY_WINDOW_MS;

  const onStartWalk = useCallback(() => {
    armWalkStart();
    router.push('/walk' as any);
  }, [router]);

  /**
   * Start a walk with a place in mind.
   *
   * The same free start path as every other walk entry point, with the selected
   * place riding alongside it. Deliberately routed through
   * `armWalkStart` rather than a route param: the arming flag is already the
   * one thing that says a walk was genuinely asked for, and a destination that
   * could arrive without it would be a way to start a walk nobody tapped for.
   *
   * The sheet closes first so the walk screen is not pushed underneath a modal.
   */
  const onWalkHere = useCallback(
    (spot: PawtchiSpot) => {
      setOpenSpot(null);
      // Start routing before navigation, so the line is waiting in the route
      // client's short in-memory cache by the time the walk screen has mounted
      // and location disclosure has settled.
      if (mapCenter) {
        prefetchWalkingRoute(mapCenter, { lat: spot.latitude, lng: spot.longitude });
      }
      armWalkStart({
        id: spot.id,
        name: displayName(spot.name, spot.category),
        lat: spot.latitude,
        lng: spot.longitude,
        // Load-bearing, and in two ways that both look optional.
        //
        // useWalkRoute reads this as `initialPosition`, and without it the
        // hook's first evaluation has no position at all — GPS has not
        // delivered a fix that early — so it returns before requesting
        // anything and the next attempt is a full EVALUATE_INTERVAL_MS away.
        // That was the ten-second wait between the timer starting and the line
        // appearing.
        //
        // It also makes the prefetch above actually land. routeClient keys its
        // cache on `from>to`, so a request from live GPS could never match one
        // prefetched from mapCenter: every prefetch was a guaranteed miss and a
        // wasted call on FOSSGIS's donated routing server. Passing the same
        // origin the prefetch used is what makes the two agree.
        origin: mapCenter ?? undefined,
      });
      track('spot_walk_started', {
        spot_category: spot.category,
        provider: spot.provider,
        dog_access_status: spot.dogAccess,
        distance_bucket: distanceBucket(spot.distanceMeters),
      });
      router.push('/walk' as any);
    },
    [mapCenter, router],
  );

  // ── First-walk intro video ────────────────────────────────────────────────
  // A one-time, ~9s silent demo of what a tracked Pawtchi walk looks like,
  // shown to fresh dog owners the first time Home mounts after onboarding.
  // Gated by useFirstWalkIntro (persisted AsyncStorage flag) and by the live
  // walk phase — an in-progress walk must never be covered by the intro.
  //
  // Cats don't see it: `walkEnabled` is false for them and Home never renders
  // this branch in the first place. Deferred until `activePet` is present so
  // it fires strictly after onboarding provisioned a pet, not on the auth
  // gate's optimistic /(tabs) redirect for a returning user.
  const walkPhase = useWalkStore(s => s.phase);
  const introEligible =
    walkEnabled && !!activePet?.id && walkPhase === 'idle';
  const { visible: introVisible, markSeenAndClose: closeIntro } = useFirstWalkIntro({
    // Namespaced per Supabase user id so two accounts on the same device each
    // see the intro once (device-scoped storage starved the second account).
    userId: user?.id ?? null,
    ready: introEligible,
    interruptible: walkPhase === 'idle',
  });
  const handleIntroDismiss = useCallback(() => {
    void closeIntro();
  }, [closeIntro]);
  const handleIntroStartWalk = useCallback(() => {
    // closeIntro persists the seen flag in the background; navigation should
    // not wait on AsyncStorage — the UX cost of a perceived pause outweighs
    // the safety margin, and the flag has already been latched to false in
    // memory (closeIntro sets visible false synchronously).
    void closeIntro();
    onStartWalk();
  }, [closeIntro, onStartWalk]);

  const latestWalkId = recentWalks[0]?.id;
  const openWalkStory = useCallback((walkId: string) => {
    const walk = recentWalks.find(w => w.id === walkId) ?? recentWalks[0];
    if (!walk || !activePet) return;
    const snapshot = createWalkStorySnapshot({
      walkSessionId: walk.id,
      petId: activePet.id,
      petName: activePet.name,
      petGender: activePet.gender,
      breed: activePet.breed,
      ageYears: activePet.age_years,
      startedAt: walk.started_at,
      durationS: walk.duration_s,
      movingTimeS: walk.moving_time_s,
      distanceM: walk.distance_m,
      avgSpeedKmh: walk.avg_speed_kmh,
      route: walk.route,
      pausePoints: walk.pause_points,
      sniffPoints: walk.sniff_points,
      startLabel: walk.start_label,
      endLabel: walk.end_label,
      farthestLabel: walk.farthest_label,
      weather: walk.weather,
      totals: storyTotals,
    });
    if (snapshot) primeWalkStory(snapshot);
    router.push({ pathname: '/walk-story', params: { id: walk.id, source: 'rail' } });
  }, [activePet, primeWalkStory, recentWalks, router, storyTotals]);

  const onAvatarPress = useCallback(() => {
    if (hasFreshStory && latestWalkId) openWalkStory(latestWalkId);
    else onStartWalk();
  }, [hasFreshStory, latestWalkId, openWalkStory, onStartWalk]);

  React.useEffect(() => {
    if (hasFreshStory) track('walk_story_ring_shown', {});
  }, [hasFreshStory, latestWalkId]);

  // ── The value-moment ask ──────────────────────────────────────────────────
  // Deliberately not on first launch. iOS grants exactly one permission prompt
  // per install; spending it on someone who has not yet seen the app do
  // anything is how opt-in ended up at 9%.
  React.useEffect(() => {
    if (primerConsidered.current) return;
    if (!activePet || notifPermission.status === 'loading') return;
    if (!notifPermission.canAsk || notifPermission.isGranted) return;
    const hasLogged = todayCalories > 0 || currentStreak > 0;
    if (!hasLogged) return;

    primerConsidered.current = true;
    void (async () => {
      const last = await AsyncStorage.getItem(primerCooldownKey(user?.id));
      const lastAt = last ? Number(last) : 0;
      const fourteenDays = 14 * 24 * 60 * 60 * 1000;
      if (Date.now() - lastAt < fourteenDays) return;
      setHomePrimerVisible(true);
      await AsyncStorage.setItem(primerCooldownKey(user?.id), String(Date.now()));
      supabase.rpc('record_notification_permission', {
        p_status: notifPermission.status,
        p_primer_shown: true,
      }).then(() => {});
    })();
  }, [activePet, notifPermission.status, notifPermission.canAsk, notifPermission.isGranted, todayCalories, currentStreak, user?.id]);

  const notificationsUnreachable =
    notifPermission.status !== 'loading' && !notifPermission.isReachable;

  /**
   * The bell's tap, which has to serve two jobs at once.
   *
   * When the app cannot reach this owner at all, being reachable is the only
   * thing worth doing — and it routes by *why*, because the three "off" states
   * need three different fixes. A blocked user cannot be re-prompted by
   * anything the app renders; only system settings can help them.
   *
   * Otherwise it opens the center.
   */
  const handleNotificationBellPress = () => {
    track('ui_button_tapped', {
      button: 'home_notification_bell',
      state: notifPermission.status,
      unread: unreadCount,
    });
    if (notificationsUnreachable) {
      if (notifPermission.isBlocked) notifPermission.openSystemSettings();
      else if (notifPermission.canAsk) setHomePrimerVisible(true);
      else router.push('/notifications' as any);
      return;
    }
    router.push('/inbox' as any);
  };

  const handleHomePrimerAccept = async () => {
    setHomePrimerVisible(false);
    try {
      await requestNotificationPermission();
    } catch {
      // A denied prompt or a missing native module both just mean no token.
    }
    await notifPermission.refresh();
  };

  /**
   * The top-right slot: the way into the notification center.
   *
   * The coin pill used to live here and no longer does. With a third segment on
   * the control the row ran out of room and the balance was pushing the pet's
   * own name into the tabs — and a coin count is the least urgent thing on this
   * screen, since PawCoins are not spendable yet. It still shows on Meal and in
   * the Shop, so the balance is not hidden, just not competing with navigation.
   *
   * The bell is now permanent furniture here, which the warning chip it replaced
   * deliberately was not. That is the trade the center makes: this is the only
   * entry point to everything the app has to say, so it cannot come and go.
   */
  const trailing = (
    <NotificationBell
      count={unreadCount}
      urgent={urgentUnread}
      unreachable={notificationsUnreachable}
      isBlocked={notifPermission.isBlocked}
      onPress={handleNotificationBellPress}
    />
  );

  /**
   * What is left on Home.
   *
   * Every banner that used to stack here — trial, vet-tuned nutrition, severe
   * obesity, growth phase, MER recalibration, cat refusing food — is now derived
   * into the notification center by lib/notificationCenter/bannerRules.ts and
   * rendered there. Nothing below is a nudge: these are earned celebrations and
   * the permission primer, which are moments rather than messages.
   */
  const overlays = (
    <>
      <WalksignMomentModal
        celebration={walksignMoment}
        petName={activePet?.name}
        petGender={activePet?.gender}
        onClose={dismissWalksignMoment}
      />
      <MilestoneCelebration />
      <TemplateUnlockCelebration />
      <NotificationPrimer
        visible={homePrimerVisible}
        petName={petName}
        source="home_value_moment"
        onAccept={handleHomePrimerAccept}
        onDecline={() => setHomePrimerVisible(false)}
      />
      <FirstWalkIntroVideo
        visible={introVisible}
        onDismiss={handleIntroDismiss}
        onStartWalk={handleIntroStartWalk}
      />
    </>
  );

  // ── Cats: no map, no rail — a plain list of what applies to them ──────────
  if (!walkEnabled) {
    return (
      <View style={styles.container}>
        {overlays}
        <ScrollView
          contentContainerStyle={[styles.plainContent, { paddingTop: insets.top + space.md }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.plainHeader}>
            <Text style={styles.plainName}>{petName}</Text>
            {trailing}
          </View>
          <TouchableOpacity
            style={styles.inviteRow}
            onPress={() => router.push('/invite' as any)}
            activeOpacity={0.8}
          >
            <View style={styles.inviteIcon}>
              <MaterialIcons name="group-add" size={18} color={color.navy} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.inviteTitle}>A friend for {petName}</Text>
              <Text style={styles.inviteSub}>Pawtchi is better shared</Text>
            </View>
            <MaterialIcons name="chevron-right" size={18} color={color.slateFaint} />
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {overlays}

      {/* Layer 1 — the map, edge to edge, never covered. */}
      <HomeMapLayer
        route={selectedRoute}
        frameBottomInset={previewSheetInset}
        frameTopInset={previewTopInset}
        center={mapCenter}
        markers={markers}
        keepsakePins={keepsakePins}
        keepsakeContext={keepsakeContext}
        resolving={mapResolving}
        // Only Spots clusters and only Spots is tappable. Walk and sniff pins
        // stay decorative: the rail is how you browse those, and making them
        // touchable would add a second way to do the same thing.
        clustered={segment === 'spots'}
        onMarkerPress={segment === 'spots' ? onMarkerPress : undefined}
        onSurfaceResolved={onMapSurface}
        // Only Spots has anywhere to put this. Tracking where the map has been
        // dragged to costs nothing on the other segments, but there is no
        // question to ask about it there, so we don't ask for the updates.
        onViewCameraChange={segment === 'spots' ? onViewCameraChange : undefined}
      />

      {/* Layer 2 — the floating chrome. `box-none` throughout so every gap in
          it falls through to the map rather than swallowing the touch. */}
      <View
        style={[
          styles.chrome,
          {
            paddingTop: insets.top + space.sm,
            // Clears the floating bar, which now overlaps this screen.
            paddingBottom: TAB_BAR_CLEARANCE + insets.bottom,
          },
        ]}
        pointerEvents="box-none"
      >
        <Reanimated.View entering={entrance(0)} pointerEvents="box-none">
          <HomeTopBar
            petName={activePet?.name}
            walksign={activePet?.walksign}
            avatarUri={
              activePet?.current_avatar_url ||
              resolvePetImage(activePet?.image_url, activePet?.species, 200)
            }
            storyRingEnabled={storyRingEnabled}
            hasFreshStory={hasFreshStory}
            onAvatarPress={onAvatarPress}
            segment={segment}
            onSegmentChange={onSegmentChange}
            spotsEnabled={spotsEnabled}
            trailing={trailing}
          />
        </Reanimated.View>

        {/* Category chips, only in Spots. Filtering runs on the data already
            fetched and never triggers a request — see lib/spots/filters.ts. */}
        {segment === 'spots' && (
          <SpotFilterRail
            selected={spotFilter}
            available={spotFilters}
            onSelect={next => {
              setSpotFilter(next);
              setSelectedId(null);
              track('spots_filter_selected', { spot_category: next });
            }}
          />
        )}

        {/* The nudge card used to float here. It is gone: nothing the app has
            to say covers the map any more, and the bell in the row above is the
            single way in. */}

        {showLocationPrompt && (
          <MapLocationPrompt
            needsDisclosure={locationNeedsDisclosure}
            onAllow={requestLocation}
            onDismiss={() => setLocationPromptDismissed(true)}
          />
        )}

        <View style={{ flex: 1 }} pointerEvents="none" />

        {/* The cabinet: map controls sit directly above the rail, and the record
            action lives in the tab bar rather than here — see SplitTabBar. */}
        <View style={styles.cabinet} pointerEvents="box-none">
          <Reanimated.View entering={entrance(1)} pointerEvents="box-none">
            <MapControls
              galleryEnabled={walkItems.length >= 2}
              onFindFriend={() => router.push('/invite' as any)}
              // A searched-elsewhere map is just as "off its default" as a
              // swiped rail, and this is the one control that takes it back.
              canRecentre={selectedId !== null || searchCenter !== null}
              onRecentre={onRecentre}
              onRefreshSpots={segment === 'spots' ? refreshSpots : undefined}
              onExpandSpots={segment === 'spots' && canExpandSpots ? expandSpots : undefined}
              onSearchArea={canSearchArea ? onSearchArea : undefined}
            />
          </Reanimated.View>

          <Reanimated.View entering={entrance(2)} pointerEvents="box-none">
            <HomeRail
              entries={entries}
              onSelect={onRailSelect}
              onOpenWalk={openWalkStory}
              onOpenSpot={onOpenSpot}
            />
          </Reanimated.View>

          {/* The OSM credit is NOT here.
              It floats, anchored to the screen, below this whole subtree — see
              the note at the end of this component. Putting it in this column
              is what pushed the rail and the map controls up out from behind
              an open sheet: the cabinet is bottom-anchored, so a margin on its
              last child moves every sibling above it. */}
        </View>
      </View>

      {/* ── ODbL, floating ──
          The spot data is OSM-derived on both platforms, and on iOS the
          basemap is Apple's, so without this the screen shows OSM data with no
          OSM credit anywhere.

          Absolutely positioned against the SCREEN rather than placed in the
          chrome column, for one reason: it has to move when a details sheet
          opens, and anything that moves inside a bottom-anchored flex column
          drags its siblings with it. Out of the flow, it can be lifted over the
          sheet without the rail or the map controls noticing.

          Above the sheet's measured top edge when one is open, above the tab
          bar otherwise. The sheet is a Modal in its own layer, so this never
          overlaps it — it sits in the map area that remains. */}
      {segment === 'spots' && (
        <View
          pointerEvents="box-none"
          style={[
            styles.attribution,
            {
              bottom: previewSheetInset
                ? previewSheetInset + space.sm
                : TAB_BAR_CLEARANCE + insets.bottom,
            },
          ]}
        >
          <OsmAttribution />
        </View>
      )}

      <SpotDetailsSheet
        spot={openSpot}
        visits={openSpot ? spotVisits[openSpot.id] ?? 0 : 0}
        onWalkHere={onWalkHere}
        way={openSpotWay}
        petName={activePet?.name ?? null}
        routeDistanceM={spotPreview.distanceM}
        routeStatus={spotPreview.status}
        onHeightChange={setPreviewSheetHeight}
        onClose={() => setOpenSpot(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.surfaceSubtle,
  },
  chrome: {
    ...StyleSheet.absoluteFillObject,
    // The tab bar floats now (`position: 'absolute'` in (tabs)/_layout.tsx), so
    // this screen runs the full height of the display and the bar sits ON it —
    // which is the point: the map reaches the bottom edge instead of stopping
    // at an opaque strip. The chrome has to buy that room back for itself, or
    // the rail would sit underneath the pill.
    //
    // The inset is added at the call site, not here, so this stays a plain
    // style object.
    gap: space.md,
  },
  cabinet: {
    // Tighter than the screen's general rhythm: the rail and the CTA are one
    // object, and spacing them like unrelated sections broke that reading.
    gap: space.sm,
  },
  /** `bottom` is supplied at the call site — it depends on the open sheet. */
  attribution: {
    position: 'absolute',
    left: 0,
  },


  // ─── Cat layout ───
  plainContent: {
    paddingHorizontal: 20,
    paddingBottom: 120 + TAB_BAR_CLEARANCE,
    gap: space.xxl,
  },
  plainHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  plainName: {
    fontFamily: font.bold,
    fontSize: 20,
    color: color.ink,
  },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.lg,
    borderTopWidth: 1,
    borderTopColor: color.hairline,
  },
  inviteIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteTitle: {
    fontFamily: font.bold,
    fontSize: 14,
    color: color.ink,
  },
  inviteSub: {
    fontFamily: font.regular,
    fontSize: 12,
    color: color.slateMuted,
    marginTop: 1,
  },
});
