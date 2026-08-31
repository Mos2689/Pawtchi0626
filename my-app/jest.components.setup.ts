/**
 * Setup for the `components` Jest project.
 *
 * The `lib` project runs in a node environment with react-native stubbed out
 * wholesale (lib/__mocks__/react-native.ts). That stub cannot coexist with
 * jest-expo, which needs the real module — hence two projects rather than one
 * config with a wider `roots`.
 *
 * Only the native-side modules that cannot run under Jest are mocked here.
 * Anything that affects the behaviour under test is left real, or the test
 * stops proving anything.
 */

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

jest.mock('expo-image', () => {
  const { View } = require('react-native');
  return { Image: View };
});
