/**
 * useWalkKeepsakes — the orchestration behind capturing moments on a walk.
 *
 * All the decisions live in pure modules (capturePrompt, placeMemory,
 * placeKey); this hook is the wiring that gives them a clock, a position and
 * somewhere to put the result. It exists so app/walk.tsx does not grow another
 * two hundred lines of state.
 *
 * ── The ordering problem it solves ──
 * A walk has no `walk_sessions` row until it saves, but photos are taken in the
 * middle of it. So captures are held in memory as drafts and flushed the moment
 * a session id appears. That ordering also means a discarded walk simply never
 * writes its keepsakes — no orphan rows, no cleanup pass.
 *
 * ── Failure posture ──
 * Nothing here may fail a walk. Every write is best-effort; the photo is
 * already safe in the user's own library the instant it is taken, which is the
 * entire point of the local-first design.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WalkSessionState } from '../lib/walk/walkSession';
import { liveSniffState } from '../lib/walk/walkSession';
import {
  initialCapturePromptState,
  markCapturePrompted,
  shouldPromptCapture,
  type CapturePromptState,
} from '../lib/walk/capturePrompt';
import {
  evaluatePlaceMemory,
  type PlaceMemoryOffer,
} from '../lib/walk/placeMemory';
import { placeKeyOrNull } from '../lib/walk/placeKey';
import { elapsedSecondsInto, snapToRoute, type Keepsake } from '../lib/walk/keepsake';
import {
  fetchPlaceCandidates,
  fetchPendingThumbnails,
  insertKeepsake,
  attachThumbnail,
} from '../lib/walk/keepsakeSync';
import { uploadThumbnail, thumbnailUrl } from '../lib/walk/keepsakeThumbnail';
import { sweepKeepsakeFiles } from '../lib/walk/keepsakeFile';
import { readPlacePromptLog, recordPlacePrompt } from '../lib/walk/placePromptLog';
import { haversineMeters } from '../lib/walk/geo';
import type { WalkCaptureResult } from '../components/walk/WalkCamera';
import type { KeepsakePromptKind } from '../components/walk/KeepsakePrompt';

/** A capture waiting for the walk to save and hand over its session id. */
export interface PendingCapture extends WalkCaptureResult {
  lat: number | null;
  lng: number | null;
  routeIndex: number | null;
  elapsedS: number | null;
  placeKey: string | null;
}

export interface ActivePrompt {
  kind: KeepsakePromptKind;
  anchorUri: string | null;
  anchorAgeDays: number | null;
}

interface UseWalkKeepsakesInput {
  enabled: boolean;
  ownerId: string | null;
  petId: string | null;
  session: WalkSessionState | null;
  /** Walk start, ms. Null when no walk is in flight. */
  startedAt: number | null;
  /** The screen's ticking clock, so this re-evaluates as the walk runs. */
  now: number;
  /** Set once the walk has saved — the flush trigger. */
  walkSessionId: string | null;
}

/**
 * How far the walker must move before we ask the database about a new place,
 * and how long between asks. Place candidates change slowly and GPS fixes
 * arrive every few seconds; without this the hook would issue a query per fix
 * for a feature that fires once a fortnight.
 */
const PLACE_QUERY_MIN_MOVE_M = 40;
const PLACE_QUERY_MIN_INTERVAL_MS = 45_000;

export function useWalkKeepsakes(input: UseWalkKeepsakesInput) {
  const { enabled, ownerId, petId, session, startedAt, now, walkSessionId } = input;

  const [cameraOpen, setCameraOpen] = useState(false);
  const [prompt, setPrompt] = useState<ActivePrompt | null>(null);
  /**
   * Everything captured on this walk, for display.
   *
   * Kept separately from the flush queue (`pendingRef`), which is drained on
   * write. The summary needs these AFTER the flush has emptied that queue, and
   * it needs them instantly — the local uri is already on disk, so the summary
   * can show the photo without waiting for an insert, an upload, or a signed
   * URL to come back.
   */
  const [captures, setCaptures] = useState<PendingCapture[]>([]);

  const pendingRef = useRef<PendingCapture[]>([]);
  const promptStateRef = useRef<CapturePromptState>(initialCapturePromptState);
  const placeLogRef = useRef<Record<string, number>>({});
  const placeOffersRef = useRef(0);
  const lastPlaceQueryRef = useRef<{ at: number; lat: number; lng: number } | null>(null);
  const pendingPlaceKeyRef = useRef<string | null>(null);
  const flushedRef = useRef<string | null>(null);

  const position = session?.lastAccepted
    ? { lat: session.lastAccepted.lat, lng: session.lastAccepted.lng }
    : null;

  // ── Load the cross-walk place cooldown once per account ──
  useEffect(() => {
    if (!enabled || !ownerId) return;
    let cancelled = false;
    void readPlacePromptLog(ownerId).then((log) => {
      if (!cancelled) placeLogRef.current = log;
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, ownerId]);

  // ── Reset per-walk state when a new walk begins ──
  useEffect(() => {
    if (startedAt == null) return;
    pendingRef.current = [];
    promptStateRef.current = initialCapturePromptState;
    placeOffersRef.current = 0;
    lastPlaceQueryRef.current = null;
    pendingPlaceKeyRef.current = null;
    flushedRef.current = null;
    setCaptures([]);
    setPrompt(null);
  }, [startedAt]);

  // ── The sniff-triggered capture prompt ──
  useEffect(() => {
    if (!enabled || prompt || cameraOpen || !session || startedAt == null) return;

    const sniff = liveSniffState(session, now);
    if (!sniff) return;

    if (
      !shouldPromptCapture({
        sniff,
        now,
        walkStartedAt: startedAt,
        state: promptStateRef.current,
      })
    ) {
      return;
    }

    promptStateRef.current = markCapturePrompted(promptStateRef.current, sniff, now);
    setPrompt({ kind: 'sniff', anchorUri: null, anchorAgeDays: null });
  }, [enabled, prompt, cameraOpen, session, startedAt, now]);

  // ── Place memory: does this spot already hold a moment? ──
  //
  // Deliberately NOT keyed on `now` or on the `position` object.
  //
  // `now` ticks every second and `position` is a fresh object each render, so
  // an effect depending on either re-runs constantly. With a cancel-on-cleanup
  // pattern that is fatal rather than merely wasteful: a place query plus a
  // signed-URL round trip takes longer than a second, so every attempt would be
  // cancelled by the next tick and the prompt could never fire once. Instead
  // the clock lives in a ref, the effect keys on the coordinate's primitives,
  // and an in-flight guard stops overlapping queries stacking up.
  const nowRef = useRef(now);
  nowRef.current = now;
  const placeQueryInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const lat = position?.lat ?? null;
  const lng = position?.lng ?? null;

  useEffect(() => {
    if (!enabled || prompt || cameraOpen || !petId || !ownerId) return;
    if (lat == null || lng == null) return;
    if (placeQueryInFlightRef.current) return;

    const at = nowRef.current;
    const last = lastPlaceQueryRef.current;
    if (last) {
      const movedM = haversineMeters(last, { lat, lng });
      if (movedM < PLACE_QUERY_MIN_MOVE_M && at - last.at < PLACE_QUERY_MIN_INTERVAL_MS) return;
    }
    lastPlaceQueryRef.current = { at, lat, lng };
    placeQueryInFlightRef.current = true;

    void (async () => {
      try {
        const candidates: Keepsake[] = await fetchPlaceCandidates(petId, lat, lng);
        if (!mountedRef.current || candidates.length === 0) return;

        const here = placeKeyOrNull(lat, lng);
        const offer: PlaceMemoryOffer | null = evaluatePlaceMemory({
          here: { lat, lng },
          now: nowRef.current,
          candidates,
          lastPromptAt: here ? placeLogRef.current[here] ?? null : null,
          offersThisWalk: placeOffersRef.current,
        });
        if (!mountedRef.current || !offer) return;

        // Resolve the anchor's image before offering: a then/now that opens to
        // an empty frame is a promise broken at the moment the user leaned in.
        const uri = offer.anchor.thumbPath ? await thumbnailUrl(offer.anchor.thumbPath) : null;
        if (!mountedRef.current || !uri) return;

        placeOffersRef.current += 1;
        const anchorPlaceKey = offer.anchor.placeKey ?? here;
        if (anchorPlaceKey) {
          placeLogRef.current[anchorPlaceKey] = nowRef.current;
          void recordPlacePrompt(ownerId, anchorPlaceKey, nowRef.current);
        }
        setPrompt({ kind: 'place', anchorUri: uri, anchorAgeDays: offer.ageDays });
      } finally {
        placeQueryInFlightRef.current = false;
      }
    })();
  }, [enabled, prompt, cameraOpen, petId, ownerId, lat, lng]);

  // ── Capture ──
  const onCaptured = useCallback(
    (result: WalkCaptureResult) => {
      const capture: PendingCapture = {
        ...result,
        lat,
        lng,
        routeIndex:
          lat != null && lng != null && session?.path
            ? snapToRoute(session.path, { lat, lng })
            : null,
        elapsedS: startedAt != null ? elapsedSecondsInto(startedAt, result.capturedAt) : null,
        placeKey: placeKeyOrNull(lat, lng),
      };
      pendingRef.current.push(capture);
      setCaptures((prev) => [...prev, capture]);
      setPrompt(null);
    },
    [lat, lng, session, startedAt],
  );

  // ── Flush once the walk has a session id ──
  useEffect(() => {
    if (!enabled || !walkSessionId || !ownerId || !petId) return;
    if (flushedRef.current === walkSessionId) return;
    if (pendingRef.current.length === 0) return;

    flushedRef.current = walkSessionId;
    const batch = pendingRef.current.slice();
    pendingRef.current = [];

    void (async () => {
      for (const capture of batch) {
        const stored = await insertKeepsake({
          ownerId,
          petId,
          walkSessionId,
          capturedAt: capture.capturedAt,
          lat: capture.lat,
          lng: capture.lng,
          routeIndex: capture.routeIndex,
          elapsedS: capture.elapsedS,
          source: 'camera',
          localPath: capture.localPath,
          localAssetId: capture.localAssetId,
          width: capture.width,
          height: capture.height,
          placeKey: capture.placeKey,
        });
        if (!stored) continue;

        // The thumbnail follows the row rather than gating it: a keepsake that
        // has not uploaded yet is still perfectly usable from the local
        // original, so a bad network costs durability later, never the moment.
        const path = await uploadThumbnail({
          ownerId,
          keepsakeId: stored.id,
          uri: capture.uri,
          width: capture.width,
          height: capture.height,
        });
        if (path) await attachThumbnail(stored.id, path);
      }

      // ── Keep our own copies within budget ──
      //
      // Runs after the uploads, not before, so a capture that just became
      // durable is eligible and one that did not is protected. The protected
      // list is every keepsake still owing a thumbnail — for those the file we
      // hold is the only copy anywhere, and the budget yields to that.
      try {
        const pending = await fetchPendingThumbnails(petId, 100);
        sweepKeepsakeFiles(pending.flatMap((k) => (k.localPath ? [k.localPath] : [])));
      } catch {
        // A sweep that does not happen costs disk, never a photo.
      }
    })();
  }, [enabled, walkSessionId, ownerId, petId]);

  const openCamera = useCallback(() => {
    setPrompt(null);
    setCameraOpen(true);
  }, []);
  const closeCamera = useCallback(() => setCameraOpen(false), []);
  const dismissPrompt = useCallback(() => setPrompt(null), []);

  return {
    cameraOpen,
    openCamera,
    closeCamera,
    onCaptured,
    prompt,
    dismissPrompt,
    captures,
    capturedCount: captures.length,
  };
}
