// The Expo half of diagnostics: what phone, what build, what locale.
//
// Split out of `diagnostics.ts` on purpose. That module holds the redaction
// rules and is covered by a ts-jest unit test; this one is field reads against
// native modules that jest has no mocks for. Keeping them apart means the part
// with rules in it stays testable without mocking four Expo packages.
//
// Every read is defensive. A diagnostics blob with a null field is mildly less
// useful; an exception thrown while assembling one would lose the whole support
// request, which is a far worse outcome than not knowing the device model.

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Application from 'expo-application';
import * as Device from 'expo-device';
import * as Localization from 'expo-localization';

import type { DeviceContext } from './diagnostics';

function attempt<T>(fn: () => T): T | null {
  try {
    const v = fn();
    return v === undefined ? null : v;
  } catch {
    return null;
  }
}

/**
 * Read everything the device will tell us. Synchronous and cheap — all of these
 * are constants the Expo modules resolved at startup.
 */
export function collectDeviceContext(): DeviceContext {
  return {
    // The version people quote in a review; the build number is what actually
    // identifies the binary when two builds share a version.
    app_version: attempt(() => Constants.expoConfig?.version ?? null),
    build: attempt(() =>
      Platform.OS === 'ios'
        ? Application.nativeBuildVersion
        : Application.nativeBuildVersion ?? null,
    ),

    os: attempt(() => Platform.OS),
    os_version: attempt(() => Device.osVersion ?? String(Platform.Version)),
    device_model: attempt(() => Device.modelName ?? null),
    is_device: attempt(() => Device.isDevice),

    locale: attempt(() => Localization.getLocales()[0]?.languageTag ?? null),
    timezone: attempt(() => Localization.getCalendars()[0]?.timeZone ?? null),
  };
}
