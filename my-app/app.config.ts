import type { ConfigContext, ExpoConfig } from 'expo/config';
import featureFlags from './constants/featureFlags.json';

const LOCATION_PERMISSION =
  "Pawtchi uses your location during a tracked walk to measure the route, distance and time, so the walk is logged for your pet automatically.";

const WALK_ANDROID_PERMISSIONS = [
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
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
  const currentPermissions = config.android?.permissions ?? [];
  const currentBlocked = config.android?.blockedPermissions ?? [];

  const permissions = walkEnabled
    ? unique([...currentPermissions, ...WALK_ANDROID_PERMISSIONS])
    : currentPermissions.filter(
        permission => !REMOVE_WHEN_WALK_DISABLED.includes(permission as never),
      );

  // ACCESS_BACKGROUND_LOCATION is intentionally blocked in both states. The
  // foreground service keeps an active, user-visible walk alive without asking
  // for the broader "always allow" permission.
  const blockedPermissions = walkEnabled
    ? unique([
        ...currentBlocked.filter(permission => !WALK_ANDROID_PERMISSIONS.includes(permission as never)),
        'android.permission.ACCESS_BACKGROUND_LOCATION',
      ])
    : unique([...currentBlocked, ...BLOCKED_WHEN_WALK_DISABLED]);

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
