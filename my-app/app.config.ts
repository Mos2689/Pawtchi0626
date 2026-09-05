import type { ConfigContext, ExpoConfig } from 'expo/config';
import featureFlags from './constants/featureFlags.json';

// Covers BOTH uses, because a permission string a reviewer can catch us
// exceeding is worse than a slightly longer one. The second sentence exists
// because Home centres its map on the device's location for owners who have no
// recorded walk yet; the original copy promised location was only read "during
// a tracked walk", which that feature would have made untrue.
const LOCATION_PERMISSION =
  'Pawtchi uses your location during a tracked walk to measure the route, distance and time, so the walk is logged for your pet automatically. It is also used to centre the map on your home screen until your first walk draws itself.';

const WALK_ANDROID_PERMISSIONS = [
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
] as const;

// ── Camera and photo-library strings ──
//
// Each of these covers EVERY use of its permission, for the same reason
// LOCATION_PERMISSION does. iOS shows one string per permission, and the
// expo-camera / expo-media-library plugin mods overwrite whatever app.json set
// during prebuild — so a walk-only sentence here would silently replace the
// food-scanner's copy and start describing the wrong feature. These must stay
// in sync with the matching keys in app.json (which apply when the camera flag
// is off and the plugins are absent).
//
// They also state the architecture plainly, because the architecture is the
// reassurance: the original never leaves the device, and what Pawtchi keeps is
// a thumbnail and a position on the route.
const CAMERA_PERMISSION =
  'Pawtchi uses your camera to scan your pet’s food and analyse its nutritional content, and to capture a moment during a walk without leaving the app. Walk photos stay on this device, and a copy is saved to your own photo library. Only a small thumbnail and where along the walk each one was taken is ever uploaded.';

// Read access. Deliberately NOT what the walk camera or the profile picture
// use: captures are read back from Pawtchi's own storage, and the picture
// picker runs out-of-process and needs no permission at all. What is left is
// walk photos taken before the app kept its own copy, whose only original is
// in the library. Once those have aged out this string — and the permission —
// can go, and iOS will have no photo-library sheet left to show.
const PHOTO_LIBRARY_PERMISSION =
  'Pawtchi asks for your photo library only to open walk photos you took before an earlier version of the app, whose originals live there. Nothing else is read, and no photo is uploaded.';

// Write access — now the primary photo permission, and the only one an ordinary
// new user will ever see. Add-only authorisation has no "limited" state, so it
// cannot produce the "Select More Photos" sheet.
const PHOTO_LIBRARY_ADD_PERMISSION =
  'Pawtchi may save scanned food images and the photos you capture during a walk to your own photo library, so they sit alongside the rest of your photos.';

const CAMERA_ANDROID_PERMISSIONS = [
  'android.permission.CAMERA',
] as const;

/**
 * Permissions the camera libraries declare that Pawtchi must NEVER request,
 * in either flag state.
 *
 * expo-camera ships RECORD_AUDIO in its own manifest because it supports video.
 * Pawtchi's walk camera is stills-only by design, so autolinking would
 * otherwise merge a microphone permission into the app for a capability that
 * does not exist — putting "Microphone" on the store listing and inviting
 * exactly the kind of permission question this app has been rejected over
 * before. Setting `recordAudioAndroidPermission: false` on the plugin is not
 * enough; the library's manifest entry has to be removed at merge time.
 *
 * Revisit only if video capture is ever actually built.
 */
const ALWAYS_BLOCKED_MEDIA_PERMISSIONS = [
  'android.permission.RECORD_AUDIO',
  // Photo selection is handled by expo-image-picker's Android system photo
  // picker. The walk camera may write its own capture to MediaStore on modern
  // Android, but it never needs permission to enumerate the user's library.
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_MEDIA_AUDIO',
  'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
] as const;

const BLOCKED_WHEN_WALK_DISABLED = [
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
] as const;

const REMOVE_WHEN_WALK_DISABLED = [
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
] as const;

type ExpoPlugin = NonNullable<ExpoConfig['plugins']>[number];

function pluginName(plugin: ExpoPlugin): string {
  return (Array.isArray(plugin) ? plugin[0] : plugin) ?? '';
}

function upsertPlugin(
  plugins: ExpoPlugin[],
  name: string,
  options: Record<string, unknown>,
): ExpoPlugin[] {
  return [
    ...plugins.filter(plugin => pluginName(plugin) !== name),
    [name, options] as ExpoPlugin,
  ];
}

function unique<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}

export default ({ config }: ConfigContext): ExpoConfig => {
  if (!config.name || !config.slug) {
    throw new Error('app.json must define both expo.name and expo.slug');
  }
  const walkEnabled = featureFlags.walkTracking;
  // The camera only exists inside a tracked walk, so it can never be enabled on
  // its own — that would ask for a camera permission for a feature the build
  // has no way to reach.
  const cameraEnabled = walkEnabled && featureFlags.walkCamera;
  // Same reasoning: the Live Activity has nothing to show without tracked walks.
  const liveActivityEnabled = walkEnabled && featureFlags.walkLiveActivity;
  const currentPermissions = config.android?.permissions ?? [];
  const currentBlocked = config.android?.blockedPermissions ?? [];

  const walkPermissions = walkEnabled
    ? unique([...currentPermissions, ...WALK_ANDROID_PERMISSIONS])
    : currentPermissions.filter(
        permission => !REMOVE_WHEN_WALK_DISABLED.includes(permission as never),
      );

  const permissions = cameraEnabled
    ? unique([...walkPermissions, ...CAMERA_ANDROID_PERMISSIONS])
    : walkPermissions.filter(
        permission => !CAMERA_ANDROID_PERMISSIONS.includes(permission as never),
      );

  // ACCESS_BACKGROUND_LOCATION is intentionally blocked in both states. The
  // foreground service keeps an active, user-visible walk alive without asking
  // for the broader "always allow" permission.
  const walkBlocked = walkEnabled
    ? unique([
        ...currentBlocked.filter(permission => !WALK_ANDROID_PERMISSIONS.includes(permission as never)),
        'android.permission.ACCESS_BACKGROUND_LOCATION',
      ])
    : unique([...currentBlocked, ...BLOCKED_WHEN_WALK_DISABLED]);

  // With the camera off, block its permissions outright. Autolinking merges
  // each library's own AndroidManifest into the app's, so simply not listing
  // CAMERA is not the same as not asking for it — blocking is what actually
  // keeps it out of the built manifest, and out of the store listing.
  const cameraBlocked = cameraEnabled
    ? walkBlocked.filter(permission => !CAMERA_ANDROID_PERMISSIONS.includes(permission as never))
    : unique([...walkBlocked, ...CAMERA_ANDROID_PERMISSIONS]);

  // Blocked in both states — see ALWAYS_BLOCKED_MEDIA_PERMISSIONS.
  const blockedPermissions = unique([...cameraBlocked, ...ALWAYS_BLOCKED_MEDIA_PERMISSIONS]);

  let plugins = [...(config.plugins ?? [])];
  plugins = upsertPlugin(plugins, 'expo-location', {
    locationWhenInUsePermission: walkEnabled ? LOCATION_PERMISSION : false,
    isIosBackgroundLocationEnabled: walkEnabled,
    isAndroidBackgroundLocationEnabled: false,
    isAndroidForegroundServiceEnabled: walkEnabled,
  });
  plugins = upsertPlugin(plugins, 'expo-maps', {
    requestLocationPermission: walkEnabled,
    locationPermission: LOCATION_PERMISSION,
  });
  // Registered ONLY when the feature is on.
  //
  // Passing `false` for the permission strings is not enough on its own: these
  // plugins also inject their Android permissions, and they run after this
  // function returns, so anything filtered out of `permissions` above would be
  // added straight back. A disabled build must not request CAMERA at all —
  // hence "omit the plugin" rather than "configure it quietly", with
  // blockedPermissions below as the backstop against autolinked manifest
  // entries from the libraries themselves.
  if (cameraEnabled) {
    plugins = upsertPlugin(plugins, 'expo-camera', {
      cameraPermission: CAMERA_PERMISSION,
      // Audio belongs to video capture, which is deliberately out of scope for
      // v1 — so this stays off and the microphone string never appears.
      recordAudioAndroidPermission: false,
      microphonePermission: false,
    });
    plugins = upsertPlugin(plugins, 'expo-media-library', {
      photosPermission: PHOTO_LIBRARY_PERMISSION,
      savePhotosPermission: PHOTO_LIBRARY_ADD_PERMISSION,
      // iOS still uses the matching privacy strings above. Android photo
      // selection goes through the system picker, so the plugin must not add
      // READ_MEDIA_* permissions to the merged manifest.
      granularPermissions: [],
      isAccessMediaLocationEnabled: false,
    });
  } else {
    plugins = plugins.filter(
      plugin => pluginName(plugin) !== 'expo-camera' && pluginName(plugin) !== 'expo-media-library',
    );
  }

  // The widget extension that draws the walk Live Activity. Registered ONLY
  // when the feature is on, for the same reason expo-camera is: the plugin
  // generates a whole extra Xcode target (and its own App ID), and a build that
  // cannot reach the feature must not carry one.
  if (liveActivityEnabled) {
    plugins = upsertPlugin(plugins, '@bacons/apple-targets', {});
  } else {
    plugins = plugins.filter(
      plugin => pluginName(plugin) !== '@bacons/apple-targets',
    );
  }

  // expo-image-picker owns NSPhotoLibraryUsageDescription in the built app.
  //
  // Not expo-media-library, despite that plugin running later in the list and
  // despite it accepting a `photosPermission` — verified with
  // `expo config --type introspect`, which is the only way to see what the mods
  // actually write. Registering the string here rather than in app.json keeps
  // it on the same constant as the other two, so the set cannot drift again.
  //
  // Only when the camera is on. In a build without it there are no walk photos
  // to re-open, and app.json's profile-picture string is the accurate one.
  if (cameraEnabled) {
    plugins = upsertPlugin(plugins, 'expo-image-picker', {
      photosPermission: PHOTO_LIBRARY_PERMISSION,
    });
  }

  plugins = upsertPlugin(plugins, '@react-native-firebase/app', {});
  plugins = upsertPlugin(plugins, '@react-native-firebase/analytics', {
    ios: {
      // Firebase measurement only: do not link AdSupport / IDFA symbols.
      withoutAdIdSupport: true,
      // Supported by RNFirebase 25's Expo config plugin. This adds the
      // privacy-preserving event-data conversion measurement pod on iOS.
      googleAppMeasurementOnDeviceConversion: true,
    },
  });

  plugins = upsertPlugin(plugins, './plugins/withFirebaseAnalyticsPrivacy', {});

  return {
    ...config,
    ios: {
      ...config.ios,
      googleServicesFile: './GoogleService-Info.plist',
      infoPlist: {
        ...config.ios?.infoPlist,
        // Suppress iOS's own "Select More Photos… / Keep Current Selection"
        // sheet, which the system throws up unprompted the first time a
        // limited-access user's library is read in an app launch.
        //
        // Unconditional, not gated on the camera flag: the profile picture,
        // onboarding and support attachments all reach the library through
        // expo-image-picker in every build, so the alert has somewhere to fire
        // from regardless. Pawtchi opens the picker itself when a photo is
        // actually wanted, which is the arrangement this key assumes — the app
        // asks at the moment of asking, and never at launch.
        PHPhotoLibraryPreventAutomaticLimitedAccessAlert: true,
        // Both keys are removed outright when the flag is off, so a disabled
        // build declares no Live Activity capability at all.
        ...(liveActivityEnabled
          ? {
              NSSupportsLiveActivities: true,
              // A walk updates its card whenever the dog covers ground, which
              // is exactly the "frequent updates" case this key describes.
              NSSupportsLiveActivitiesFrequentUpdates: true,
            }
          : {}),
      },
    },
    android: {
      ...config.android,
      googleServicesFile: './google-services.json',
      permissions,
      blockedPermissions,
    },
    plugins,
    extra: {
      ...config.extra,
      featureFlags,
    },
  } as ExpoConfig;
};
