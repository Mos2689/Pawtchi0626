import featureFlags from './featureFlags.json';

/**
 * The single source of truth for release-level feature availability.
 *
 * `app.config.ts` consumes the same JSON manifest to add/remove permissions,
 * background modes, and Expo plugin options. Runtime entry points consume the
 * aliases below. A feature must never need a second release toggle elsewhere.
 */
export const FEATURE_FLAGS = Object.freeze(featureFlags);

export const WALK_TRACKING_ENABLED = FEATURE_FLAGS.walkTracking;

// The auto-generated, in-app Walk Story (story ring on the Home avatar + the
// full-screen viewer). Also gated per-pet by useWalkEnabled() — dogs only.
export const WALK_STORY_ENABLED = FEATURE_FLAGS.walkStory;

/**
 * The walk camera — capturing moments during a walk, and the place memory built
 * on top of them.
 *
 * Unlike spotsOsmMvp this flag DOES have a native footprint: it adds the camera
 * and photo-library permissions in `app.config.ts`, so flipping it needs a
 * prebuild and a store release, not an OTA update. Off by default until the
 * permission copy has been through review — this app has been rejected over
 * permissions before, and a camera plus a photo library is exactly the pairing
 * reviewers look hardest at.
 *
 * Also gated per-pet by useWalkEnabled() downstream — dogs only, like every
 * other walk surface.
 */
export const WALK_CAMERA_ENABLED = FEATURE_FLAGS.walkCamera;

/**
 * "Add a photo from your library" on the finished-walk summary — the backstop
 * for shots taken on the phone's own camera during a walk.
 *
 * OFF (Sep 2026). The row shipped and did not work on device; rather than guess
 * at a cause it is switched off until the flow is designed properly. No native
 * footprint — the system photo picker needs no permission on either platform —
 * so this is an OTA switch, not a store release.
 *
 * The code behind it stays wired on purpose. `onImport` in app/walk.tsx, the
 * EXIF parsing in lib/walk/keepsakeExif.ts and the outbox write are all still
 * referenced and still tested; only the row is hidden. Deleting them would mean
 * rebuilding the placement-honesty rules (never borrow the walk's coordinates
 * for a photo that carries its own) from scratch.
 *
 * ── When picking this back up ──
 *  1. The `catch` in `onImport` is silent, which is why "not working" has no
 *     detail attached to it. Log or surface the error first — the answer is
 *     almost certainly in there.
 *  2. Check the picker opens at all. If it does not, suspect presentation from
 *     the summary screen rather than the picker call itself.
 *  3. Confirm a picked photo reaches `moments` and the trail re-renders; the
 *     draft is added to local state before the durable write, so display and
 *     persistence fail independently.
 *  4. lib/privacy/photoLibraryAccess.test.ts asserts this path uses the system
 *     picker and nothing else. Keep it that way — requesting library
 *     permission here would undo the whole photo architecture.
 */
export const WALK_PHOTO_IMPORT_ENABLED = FEATURE_FLAGS.walkPhotoImport;

/**
 * The iOS walk Live Activity — the Lock Screen / Dynamic Island card for a walk
 * in progress.
 *
 * Like walkCamera this flag HAS a native footprint: it registers the
 * `@bacons/apple-targets` plugin (which generates the widget extension)
 * and adds `NSSupportsLiveActivities` in `app.config.ts`, so flipping it needs
 * a prebuild and a store release, not an OTA update. Off ⇒ the build contains
 * no widget extension at all.
 *
 * The card is a read-only mirror of walk state. It cannot start, stop or
 * influence location tracking, so turning this off changes nothing about how a
 * walk is recorded — only whether the owner can see it from the Lock Screen.
 * Android has no equivalent surface yet and simply ignores this flag; it keeps
 * the foreground-service notification expo-location already posts.
 */
export const WALK_LIVE_ACTIVITY_ENABLED = FEATURE_FLAGS.walkLiveActivity;

/**
 * Pawtchi Spots — nearby dog-relevant places from OpenStreetMap.
 *
 * Unlike walkTracking this flag has NO native footprint: Spots adds no
 * permission, no plugin and no background mode, because it never reads location
 * itself — it borrows the coordinate Home already resolved. So `app.config.ts`
 * ignores this flag entirely, and the kill switch can ride an OTA update rather
 * than needing a store release.
 *
 * Off by default until the endpoint has been watched in the wild: it depends on
 * public Overpass infrastructure, which is the one part of this feature we do
 * not control. Turning it off restores the previous Home exactly — the segment
 * disappears and Walks/Sniffs are untouched.
 */
export const SPOTS_OSM_MVP_ENABLED = FEATURE_FLAGS.spotsOsmMvp;
