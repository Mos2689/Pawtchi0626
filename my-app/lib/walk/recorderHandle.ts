/**
 * recorderHandle — lending the walk camera to the screen that is actually on top.
 *
 * ── The problem ─────────────────────────────────────────────────────────────
 *
 * On a Trail there is no individual walk. The shared map IS the walk: it shows
 * the pack, it records, and every action belongs on it — including taking a
 * photo. But a capture is not a photo. It is a draft held by `useWalkKeepsakes`
 * until the walk saves and hands over a session id, and that hook lives on
 * `/walk` with the recorder. Two instances would mean two draft sets, and only
 * one of them would ever be written.
 *
 * ── Why the camera is not simply opened from underneath ─────────────────────
 *
 * `/walk` stays mounted below the shared map, so it is tempting to just flip
 * its `cameraOpen` flag from up here. `WalkCamera` is a React Native `Modal`,
 * though, and on iOS a Modal is presented by the nearest view controller —
 * which, for a screen that is no longer top of the stack, is a controller that
 * is itself already covered. That is how you get a camera that opens for some
 * people, on some OS versions, and silently does nothing for the rest.
 *
 * So the camera is rendered by whichever screen is visible, and only the parts
 * that must stay single — where a capture goes, and whether it is being shared
 * with the pack — are lent across this handle.
 *
 * Reactive because one of those parts is a toggle: the Shared/Personal switch
 * lives inside the camera but its state belongs to the recorder, so flipping it
 * has to re-render the screen holding the camera. `useSyncExternalStore` is the
 * supported way to read a mutable external value without tearing.
 *
 * In memory, never persisted, and cleared when the recorder unmounts — the same
 * discipline as walkStartIntent, for the same reason: a stale handle would let
 * a photo attach itself to a walk that has already ended.
 */

import { useSyncExternalStore } from 'react';
import type { WalkCaptureResult } from '../../components/walk/WalkCamera';

/**
 * A photo taken on this walk, as the map needs it.
 *
 * Local only, and that is the point: these exist from the instant the shutter
 * fires, long before anything is uploaded. See `captures` below.
 */
export interface LiveCapture {
  /** The shutter time, which is already this walk's unique key for a photo. */
  id: number;
  uri: string;
  lat: number | null;
  lng: number | null;
  /**
   * Whether the camera said "Shared with this walk" when the shutter fired.
   *
   * Read at capture time and never re-read, so toggling the switch afterwards
   * cannot retroactively publish a photo taken while it said Personal.
   */
  shared: boolean;
}

export interface RecorderHandle {
  /** Where a capture goes. The recorder's own draft pipeline. */
  onCaptured: (capture: WalkCaptureResult) => void;
  /** The chips the camera shows over its preview. */
  context: {
    distanceLabel: string | null;
    elapsedLabel: string | null;
    placeLabel: string | null;
  };
  /** Present only while this walk is part of a Trail. */
  sharing?: {
    packName: string;
    enabled: boolean;
    onChange: (next: boolean) => void;
  };
  /**
   * Photos taken on this walk so far, straight from the recorder's drafts.
   *
   * ── Why the shared map reads these instead of the database ────────────────
   *
   * `community_shared_media` is written by `publishCommunityCaptures`, which
   * runs once, at the end, when the walk reaches its summary. That is the right
   * moment to upload — a walk should not be spending battery and signal on
   * uploads while it is happening — but it meant the live screen's moment count
   * queried a table that is empty by construction for the entire walk. It read
   * zero after every photo, and there was nothing to pin on the map either.
   *
   * The drafts already hold everything the map needs: a local file and the
   * coordinate the shutter fired at. So the live screen counts and pins these,
   * and the upload stays where it belongs. Nothing here is a second source of
   * truth — it is the same drafts, read earlier.
   */
  captures: readonly LiveCapture[];
}

let handle: RecorderHandle | null = null;
/** Identifies the publisher, so a stale teardown cannot unpublish its successor. */
let owner: symbol | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/**
 * Publish the recorder's camera pipeline. Returns its own teardown.
 *
 * Deliberately separate from `updateRecorderHandle` below, and the split is
 * load-bearing. The labels on the camera change every second, so if publishing
 * were the only entry point the recorder's effect would have to re-run on every
 * tick — and React runs an effect's cleanup BEFORE its next body. That cleanup
 * nulls the handle, which unmounts the camera on the screen reading it. Once a
 * second. Including the second somebody is pressing the shutter.
 *
 * So publishing is tied to the walk's lifetime, and the values that tick are
 * merged in without ever passing through null.
 */
export function publishRecorderHandle(next: RecorderHandle): () => void {
  const token = Symbol('recorder');
  handle = next;
  owner = token;
  emit();
  return () => {
    if (owner === token) {
      handle = null;
      owner = null;
      emit();
    }
  };
}

/**
 * Merge new values into the published handle.
 *
 * A no-op when nothing is published: an update that arrives after the walk
 * ended has nothing to say. Replaces the object so `useSyncExternalStore` sees
 * a changed snapshot, but never with null.
 */
export function updateRecorderHandle(partial: Partial<RecorderHandle>): void {
  if (!handle) return;
  handle = { ...handle, ...partial };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function snapshot(): RecorderHandle | null {
  return handle;
}

/**
 * The live recorder, or null when nothing on this device is recording.
 *
 * Null is a real answer and callers must handle it: it means there is no walk
 * for a photo to belong to, which is different from the camera being busy.
 */
export function useRecorderHandle(): RecorderHandle | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * The store's own plumbing, for its test. The null-between-two-values rule is
 * only observable through the subscription, which is exactly why it needs
 * asserting rather than reading.
 */
export const __readRecorderHandle = snapshot;
export const __subscribeRecorderHandle = subscribe;
