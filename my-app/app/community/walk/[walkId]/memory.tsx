/**
 * The memory of a shared walk — "Trace, with the pack".
 *
 * ── Why this is a map and not a page ───────────────────────────────────────
 *
 * It used to be a scroll: a cover card, an artwork, a small map, then every
 * photo as a full-width card. Four ways of saying "here is the walk", stacked,
 * none of them the subject. The route was an illustration in one block and the
 * photos were a list in another, so the one fact that makes a shared walk worth
 * remembering — that these things happened at these places — was the one thing
 * the screen never showed.
 *
 * Now the map is the screen. The pack's lines draw themselves in on arrival,
 * the photos land where they were taken, and the sheet underneath holds who
 * walked. Everything else is one tap from there.
 *
 * ── What was kept, deliberately ────────────────────────────────────────────
 *
 * The share sheet, untouched. It encodes consent rules — map-free artwork only,
 * this dog's identity and nobody else's photos, and a warning that an export
 * cannot be recalled — and none of that is layout. A photo opened from the map
 * still gets the same card it had in the list, with its heart and its author
 * and its owner's ability to take it back out.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { FadeIn, useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import WalkMap from '../../../../components/walk/WalkMap';

import {
  CommunityButton,
  CommunityCard,
  PackRouteArtwork,
  partyColors,
} from '../../../../components/community/CommunityUI';
import { color, font, makeShadow, radius, space, type } from '../../../../constants/design';
import { KeepsakeMapOverlay, type KeepsakeMapPin } from '../../../../components/walk/KeepsakeMapOverlay';
import { KeepsakeViewer } from '../../../../components/walk/KeepsakeViewer';
import { PackTraceSheet, type PackTraceRow } from '../../../../components/community/PackTraceSheet';
import { rankTraces, togetherSeconds } from '../../../../lib/community/memoryTraces';
import { fitCamera, type MapCamera } from '../../../../lib/walk/mapCamera';
import { communityMediaUrls } from '../../../../lib/communityMedia';
import { loadMemory, removeSharedMoment, setMomentHeart, type CommunityMemory, type SharedMoment } from '../../../../lib/communityWalks';
import { shareMoment } from '../../../../lib/shareMoment';
import { useActivePetStore } from '../../../../store/useActivePetStore';
import { useAuth } from '../../../../providers/AuthProvider';

function dayLabel(value: string | null): string {
  const date = value ? new Date(value) : new Date();
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(date);
}

/**
 * "23 MIN IN · 4:12 PM", or just the clock when the walk never recorded a start.
 *
 * How far into the walk a photo was taken is the fact a shared memory turns on
 * — it is what places the moment inside the walk rather than merely on the day
 * — so it leads, and the wall-clock time follows it.
 */
function momentDateline(moment: SharedMoment, startedAt: string | null): string {
  const clock = momentTime(moment.captured_at).toUpperCase();
  const from = startedAt ? Date.parse(startedAt) : NaN;
  const at = Date.parse(moment.captured_at);
  if (!Number.isFinite(from) || !Number.isFinite(at) || at < from) return clock;
  const minutes = Math.round((at - from) / 60000);
  return `${minutes < 1 ? 'AT THE START' : `${minutes} MIN IN`} · ${clock}`;
}

function momentTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

export default function CommunityMemoryScreen() {
  const router = useRouter();
  const { walkId } = useLocalSearchParams<{ walkId: string }>();
  const activePet = useActivePetStore(state => state.activePet);
  const { user } = useAuth();
  const [memory, setMemory] = useState<CommunityMemory | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  /**
   * Whether the first load has landed. Not "is a request in flight" — it exists
   * so the empty state stays quiet until there is something to be empty about.
   */
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [includeRoute, setIncludeRoute] = useState(true);
  const [sharing, setSharing] = useState(false);
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const [stage, setStage] = useState({ width: 0, height: 0 });
  /** The walker whose line and photos the screen is currently about. */
  const [focusId, setFocusId] = useState<string | null>(null);
  const [openMoment, setOpenMoment] = useState<string | null>(null);

  const onStage = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setStage(current => (current.width === width && current.height === height
      ? current
      : { width, height }));
  }, []);

  /**
   * A walker's colour, fixed by their place in the ranked list.
   *
   * The same colour paints their line on the map, their sparkline in the sheet
   * and the highlight when they are focused. It is the only thing tying the
   * three together — without it the map is a handful of anonymous squiggles.
   */
  const traces = useMemo(() => rankTraces(memory?.traces ?? []), [memory?.traces]);
  const tintFor = useCallback(
    (userId: string) => {
      const index = traces.findIndex(trace => trace.userId === userId);
      return partyColors[(index < 0 ? 0 : index) % partyColors.length];
    },
    [traces],
  );

  /**
   * How many of the pack's lines have arrived.
   *
   * The routes land one walker at a time rather than all at once — three
   * updates about two hundred milliseconds apart, so the map assembles itself
   * instead of appearing. Deliberately NOT a per-frame draw-on: these are
   * native polylines, and animating them would mean re-sending every line to
   * the map sixty times a second, which is the exact cost the live map was
   * fixed to stop paying.
   *
   * Reduced motion gets all of them immediately.
   */
  const [landed, setLanded] = useState(0);
  const drawable = useMemo(() => traces.filter(trace => trace.routes.length > 0), [traces]);
  useEffect(() => {
    if (!drawable.length) return;
    if (reducedMotion) { setLanded(drawable.length); return; }
    setLanded(0);
    const timers = drawable.map((_, index) =>
      setTimeout(() => setLanded(index + 1), 160 + index * 190));
    return () => { timers.forEach(clearTimeout); };
  }, [drawable, reducedMotion]);

  const mapRoutes = useMemo(
    // One entry per SEGMENT, keyed on the walker and the segment's place in
    // their list. A walker who stopped and restarted has several lines and one
    // colour, which is the truth: same person, same walk, two recordings.
    () => drawable.slice(0, landed).flatMap(trace =>
      trace.routes.map((segment, index) => ({
        id: `${trace.userId}#${index}`,
        path: segment,
        color: tintFor(trace.userId),
        dashed: false,
      }))),
    [drawable, landed, tintFor],
  );

  const momentPins = useMemo<KeepsakeMapPin[]>(
    () => (memory?.moments ?? [])
      .filter(moment => moment.capture_lat != null && moment.capture_lng != null)
      .map(moment => ({
        id: moment.id,
        lat: moment.capture_lat!,
        lng: moment.capture_lng!,
        uri: moment.display_path ? urls[moment.display_path] ?? null : null,
      })),
    [memory?.moments, urls],
  );

  /**
   * Frames everything at once, above the resting sheet.
   *
   * Recomputed when the focus changes so choosing one walker zooms to their
   * walk — which is most of the payoff of choosing one.
   */
  const camera = useMemo<MapCamera | null>(() => {
    if (!stage.width || !stage.height) return null;
    const source = focusId ? traces.filter(t => t.userId === focusId) : traces;
    const points = source.flatMap(trace => trace.routes.flat());
    for (const pin of momentPins) points.push({ lat: pin.lat, lng: pin.lng });
    if (!points.length) return null;
    return fitCamera(points, {
      width: stage.width,
      height: stage.height,
      padding: { top: 96, right: 48, bottom: 150, left: 48 },
      minZoom: 12,
      maxZoom: 17,
      pointZoom: 16,
    });
  }, [focusId, momentPins, stage.height, stage.width, traces]);

  const mapCentre = traces[0]?.routes[0]?.[0] ?? (momentPins[0] ? { lat: momentPins[0].lat, lng: momentPins[0].lng } : null);

  const packRows = useMemo<PackTraceRow[]>(
    () => traces.map(trace => ({
      trace,
      person: memory?.attendance.find(row => row.user_id === trace.userId),
      tint: tintFor(trace.userId),
      moments: (memory?.moments ?? []).filter(m => m.contributor_id === trace.userId).length,
    })),
    [memory?.attendance, memory?.moments, tintFor, traces],
  );

  const memoryDay = memory?.walk.ended_at ?? memory?.walk.scheduled_for ?? null;
  const shareCardRef = useRef<View>(null);

  const load = useCallback(async () => {
    if (!walkId) return;
    setError(null);
    try {
      const next = await loadMemory(walkId);
      setMemory(next);
      setUrls(await communityMediaUrls(next.moments.flatMap(moment => moment.display_path ? [moment.display_path] : [])));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This memory could not load.');
    } finally {
      setLoaded(true);
    }
  }, [walkId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const share = async () => {
    setSharing(true);
    const outcome = await shareMoment(shareCardRef, {
      source: 'community_memory',
      ground: includeRoute ? 'route_artwork' : 'paper',
      template: 'pack_keepsake',
    });
    setSharing(false);
    if (outcome === 'shared') setShareOpen(false);
    else if (outcome === 'failed') setError('The keepsake could not be shared.');
    else setError('Sharing is unavailable on this device.');
  };


  return (
    <View style={styles.screen}>
      <View style={styles.stage} onLayout={onStage}>
        <WalkMap
          mode="summary"
          path={[]}
          communityRoutes={mapRoutes}
          center={mapCentre}
          camera={camera}
          quiet
          interactive
          style={StyleSheet.absoluteFillObject as any}
        />

        {/* Photos where they happened. Dimmed rather than removed when a
            walker is focused: they are still part of the walk, they are just
            not part of the answer to "show me theirs". */}
        <KeepsakeMapOverlay
          pins={momentPins}
          camera={camera}
          width={stage.width}
          height={stage.height}
          size={46}
          // Each photo drops in after the lines have settled, in the order it
          // was taken — so the map fills the way the walk happened.
          entering={pinId => {
            if (reducedMotion) return undefined;
            const order = momentPins.findIndex(pin => pin.id === pinId);
            return FadeIn.delay(700 + Math.max(0, order) * 110).duration(260);
          }}
          // The overlay clusters pins taken in the same place and hands back
          // the whole group. Opening the first of them is the honest read of
          // "this one" — they were all taken within a few metres.
          onPress={group => setOpenMoment(group[0]?.id ?? null)}
        />

        {/* Floating chrome, not a header band. The map runs under it edge to
            edge — a memory of a walk that reaches only halfway up the screen is
            a map being quoted rather than a map being looked at. The title sits
            on the back arrow's row, where the rest of the community screens
            put theirs. */}
        <View style={[styles.navRow, { top: insets.top + 8 }]} pointerEvents="box-none">
          <Pressable
            onPress={() => router.back()}
            style={styles.navButton}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={21} color={color.navy} />
          </Pressable>
          <View style={styles.navTitleWrap}>
            <Text style={styles.navTitle} numberOfLines={1}>
              {memory?.pack.name ?? 'A walk together'}
            </Text>
            <Text style={styles.navSub} numberOfLines={1}>{dayLabel(memoryDay)}</Text>
          </View>
          <Pressable
            onPress={() => setShareOpen(true)}
            style={styles.shareIcon}
            accessibilityRole="button"
            accessibilityLabel="Preview external keepsake"
          >
            <Ionicons name="share-outline" size={19} color={color.navy} />
          </Pressable>
        </View>

        {error ? (
          <View style={[styles.errorChip, { top: insets.top + 68 }]}><Text style={styles.errorText}>{error}</Text></View>
        ) : null}

        {traces.length === 0 && momentPins.length === 0 && loaded ? (
          <View style={styles.quiet} pointerEvents="none">
            <Ionicons name="paw-outline" size={26} color={color.slateFaint} />
            <Text style={styles.quietText}>
              A quiet walk still counts. Nobody recorded a route or shared a photo.
            </Text>
          </View>
        ) : null}
      </View>

      <PackTraceSheet
        rows={packRows}
        walkSeconds={togetherSeconds(memory?.walk ?? { started_at: null, ended_at: null })}
        momentCount={memory?.moments.length ?? 0}
        focusId={focusId}
        onFocus={setFocusId}
        bottomInset={insets.bottom}
      />

      {/* The walk's own viewer — full bleed, paging, the peek gesture — with a
          Trail's card instead of the walk's. See SharedMomentCaption for why
          the photograph half is shared and the words half is not. */}
      {openMoment ? (
        <KeepsakeViewer
          pins={momentPins}
          initialIndex={Math.max(0, momentPins.findIndex(pin => pin.id === openMoment))}
          sharedCaption={pin => {
            const moment = (memory?.moments ?? []).find(m => m.id === pin.id);
            if (!moment) return null;
            const who = memory?.attendance.find(row => row.user_id === moment.contributor_id);
            return {
              dateline: momentDateline(moment, memory?.walk.started_at ?? null),
              headline: who?.person?.full_name?.trim().split(/\s+/)[0]
                || (who?.person?.username ? `@${who.person.username}` : 'Someone on the walk'),
              detail: moment.caption
                || (who?.dogs?.length ? `Walking with ${who.dogs.map(dog => dog.name).join(' & ')}` : null),
              // Kept from the card this replaced: a heart anyone can give, and
              // a way out for the person whose photo it is. Losing either would
              // have made the new viewer a downgrade dressed as a redesign.
              actions: {
                hearted: !!moment.heartedByMe,
                heartCount: moment.heartCount ?? 0,
                onHeart: () => {
                  void setMomentHeart(moment.id, !moment.heartedByMe).then(load).catch(() => {});
                },
                onRemove: moment.contributor_id === user?.id
                  ? () => {
                      setOpenMoment(null);
                      void removeSharedMoment(moment.id).then(load).catch(() => {});
                    }
                  : undefined,
              },
            };
          }}
          onClose={() => setOpenMoment(null)}
        />
      ) : null}

      <Modal visible={shareOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShareOpen(false)}>
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHead}>
            <View>
              <Text style={styles.modalEyebrow}>EXACTLY WHAT LEAVES PAWTCHI</Text>
              <Text style={styles.modalTitle}>Share preview</Text>
            </View>
            <Pressable onPress={() => setShareOpen(false)} style={styles.closeIcon} accessibilityLabel="Close share preview">
              <Ionicons name="close" size={22} color={color.navy} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody}>
            <View ref={shareCardRef} collapsable={false} style={styles.shareCard}>
              {includeRoute ? <PackRouteArtwork compact routes={memory?.routes} /> : <View style={styles.routeFree}><Ionicons name="paw" size={34} color={color.electric} /></View>}
              <View style={styles.shareCopy}>
                <Text style={styles.shareBrand}>PAWTCHI · PACK MEMORY</Text>
                <Text style={styles.shareTitle}>{memory?.walk.title ?? 'A walk together'}</Text>
                <Text style={styles.shareDate}>{dayLabel(memory?.walk.ended_at ?? memory?.walk.scheduled_for ?? null)}</Text>
                {activePet ? <Text style={styles.shareDog}>{activePet.name} walked with the pack.</Text> : null}
                <Text style={styles.shareFoot}>Make memories with your own pack · pawtchi.com</Text>
              </View>
            </View>

            <Pressable onPress={() => setIncludeRoute(value => !value)} style={styles.routeOption} accessibilityRole="checkbox" accessibilityState={{ checked: includeRoute }}>
              <Ionicons name={includeRoute ? 'checkbox' : 'square-outline'} size={24} color={includeRoute ? color.electric : color.slateMuted} />
              <View style={styles.flex}>
                <Text style={styles.optionTitle}>Include transformed route artwork</Text>
                <Text style={styles.optionBody}>Map-free geometry only. No streets, labels, coordinates, or precise endpoints.</Text>
              </View>
            </Pressable>
            <CommunityCard style={styles.approvalNote}>
              <Ionicons name="shield-checkmark-outline" size={22} color={color.success} />
              <Text style={styles.approvalText}>This preview uses your dog’s identity and no one else’s photos. Other contributions stay private unless their contributor approves them for export. Once someone downloads an export, Pawtchi cannot recall that copy.</Text>
            </CommunityCard>
            <CommunityButton label={sharing ? 'Preparing…' : 'Share this keepsake'} icon="share-outline" onPress={() => void share()} disabled={sharing} style={styles.shareButton} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: color.surfaceSubtle },
  navRow: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    zIndex: 9,
  },
  navButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...makeShadow(4, 12, 0.12),
  },
  // A card rather than bare type: this sits on live map tiles of unknown
  // colour, and a title that is legible over a park is not legible over a road.
  navTitleWrap: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: color.surface,
    ...makeShadow(4, 12, 0.12),
  },
  navTitle: { ...type.label, fontSize: 13.5, color: color.navy },
  navSub: { ...type.caption, fontSize: 9.5, letterSpacing: 0.6, color: color.slateFaint, marginTop: 1 },
  /** The map, which is the screen. Everything else floats on it. */
  stage: { flex: 1, backgroundColor: color.surfaceSubtle },
  quiet: {
    position: 'absolute',
    left: space.xl,
    right: space.xl,
    top: '38%',
    alignItems: 'center',
    gap: space.sm,
  },
  quietText: { ...type.body, fontSize: 12.5, color: color.slateMuted, textAlign: 'center' },
  errorChip: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    top: space.md,
    padding: space.sm,
    borderRadius: radius.md,
    backgroundColor: color.errorSoft,
  },
  errorText: { ...type.label, fontSize: 12, color: color.error, textAlign: 'center' },
  shareIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    ...makeShadow(4, 12, 0.14),
  },
  cover: { borderRadius: radius.xxl, overflow: 'hidden', backgroundColor: color.navy },
  replayControl: {
    position: 'absolute',
    top: space.md,
    right: space.md,
    minHeight: 48,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    backgroundColor: color.yellow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  replayText: { ...type.label, color: color.navy },
  coverCopy: { padding: space.xl, backgroundColor: color.navy },
  coverDate: { ...type.caption, color: color.yellow },
  coverTitle: { fontFamily: font.memoryTitle, fontSize: 34, lineHeight: 40, color: color.surface, marginTop: space.sm },
  coverPlace: { ...type.body, color: 'rgba(255,255,255,0.72)', marginTop: space.xs },
  coverDogs: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.lg },
  coverDogNames: { ...type.label, color: color.surface, flex: 1 },
  routeStory: { padding: space.sm },
  routeTitle: { ...type.heading, color: color.navy, marginHorizontal: space.sm, marginTop: space.md },
  routeBody: { ...type.body, color: color.slateMuted, margin: space.sm },
  privateMap: { height: 280, borderRadius: radius.xxl, overflow: 'hidden', marginTop: space.lg, borderWidth: 1, borderColor: color.hairline },
  privateMapLabel: { position: 'absolute', left: space.md, top: space.md, minHeight: 32, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.92)', paddingHorizontal: space.md, flexDirection: 'row', alignItems: 'center', gap: 6 },
  privateMapLabelText: { ...type.caption, color: color.navy, fontSize: 9.5 },
  sparse: { alignItems: 'center', paddingVertical: space.xxl },
  sparseTitle: { ...type.heading, color: color.navy, marginTop: space.md },
  sparseBody: { ...type.body, color: color.slateMuted, textAlign: 'center', marginTop: space.sm },
  momentCard: { padding: 0, overflow: 'hidden', marginBottom: space.lg },
  momentImage: { width: '100%', aspectRatio: 4 / 3, backgroundColor: color.surfaceSubtle },
  momentPending: { width: '100%', aspectRatio: 4 / 3, backgroundColor: color.surfaceSubtle, alignItems: 'center', justifyContent: 'center' },
  momentPendingText: { ...type.body, color: color.slateMuted, marginTop: space.sm },
  momentCopy: { padding: space.lg },
  momentMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  momentTime: { ...type.label, color: color.navy },
  momentAuthor: { ...type.body, color: color.slateMuted, flex: 1, textAlign: 'right' },
  momentCaption: { ...type.heading, color: color.navy, marginTop: space.md },
  tags: { ...type.caption, color: color.electric, marginTop: space.sm },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: space.md },
  locationText: { ...type.body, color: color.slateFaint },
  momentActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.md, paddingTop: space.md, borderTopWidth: 1, borderTopColor: color.hairline },
  heartButton: { minWidth: 48, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 5 },
  heartText: { ...type.label, color: color.slateMuted },
  removeButton: { minHeight: 48, justifyContent: 'center' },
  removeText: { ...type.label, color: color.error },
  closing: { marginTop: space.xxl, padding: space.xxl, backgroundColor: color.navy, borderRadius: radius.xxl },
  closingEyebrow: { ...type.caption, color: color.yellow },
  closingTitle: { fontFamily: font.memoryTitle, fontSize: 31, lineHeight: 38, color: color.surface, marginTop: space.sm },
  closingBody: { ...type.body, color: 'rgba(255,255,255,0.72)', marginTop: space.sm },
  walkAgain: { marginTop: space.xl },
  modal: { flex: 1, backgroundColor: color.surfaceSubtle },
  modalHead: { paddingHorizontal: space.xl, paddingVertical: space.lg, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalEyebrow: { ...type.caption, color: color.electric },
  modalTitle: { ...type.title, color: color.navy, marginTop: 2 },
  closeIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center' },
  modalBody: { paddingHorizontal: space.xl, paddingBottom: space.xxxl },
  shareCard: { backgroundColor: color.surface, borderRadius: radius.xxl, overflow: 'hidden', borderWidth: 1, borderColor: color.hairline },
  routeFree: { height: 128, alignItems: 'center', justifyContent: 'center', backgroundColor: color.electricSoft },
  shareCopy: { padding: space.xl },
  shareBrand: { ...type.caption, color: color.electric },
  shareTitle: { fontFamily: font.memoryTitle, fontSize: 31, lineHeight: 38, color: color.navy, marginTop: space.sm },
  shareDate: { ...type.body, color: color.slateMuted, marginTop: 4 },
  shareDog: { ...type.heading, color: color.navy, marginTop: space.xl },
  shareFoot: { ...type.caption, color: color.slateFaint, marginTop: space.xxl },
  routeOption: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.lg },
  optionTitle: { ...type.label, color: color.navy },
  optionBody: { ...type.body, color: color.slateMuted, marginTop: 2 },
  approvalNote: { flexDirection: 'row', gap: space.md },
  approvalText: { ...type.body, color: color.slateMuted, flex: 1 },
  shareButton: { marginTop: space.lg },
});
