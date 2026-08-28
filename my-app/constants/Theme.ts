import { Platform } from 'react-native';
import { color, font } from './design';

/**
 * DEPRECATED — compatibility shim over constants/design.ts.
 *
 * This file used to hold a Stitch-generated Material token dump. Screens are
 * being migrated to import { color, font, radius, space, shadow, type } from
 * './design' directly. Until then, the most-used keys here re-point to brand
 * values so legacy imports render on-brand. Do not add new usages.
 */

const light = {
  "surface-tint": "#755700",
  "outline": color.slateMuted,
  "on-primary-fixed-variant": "#604700",
  "surface-container-low": color.surfaceSubtle,
  "on-tertiary-container": color.slate,
  "on-secondary-fixed-variant": "#972900",
  "background": color.surface,
  "primary-dim": color.yellow,
  "on-tertiary": "#faf5c0",
  "primary": color.yellow,
  "inverse-on-surface": color.slateFaint,
  "error": color.error,
  "error-dim": "#b92902",
  "on-error": "#ffefec",
  "tertiary-fixed-dim": "#f0eab6",
  "secondary-container": "#ffc4b3",
  "tertiary-fixed": "#fef8c3",
  "primary-fixed": color.yellow,
  "on-surface-variant": color.slateMuted,
  "inverse-surface": color.navy,
  "on-primary-fixed": color.navy,
  "tertiary-dim": "#54512a",
  "surface-dim": "#E9ECEF",
  "on-background": color.ink,
  "on-secondary": "#ffefeb",
  "on-tertiary-fixed-variant": "#6d6940",
  "secondary-dim": "#952800",
  "error-container": "#f95630",
  "surface": color.surface,
  "secondary-fixed": "#ffc4b3",
  "surface-container-highest": "#DEE2E6",
  "secondary": "#a83206",
  "on-error-container": "#520c00",
  "on-surface": color.ink,
  "on-secondary-container": "#862400",
  "tertiary": "#605d34",
  "surface-container-lowest": color.surface,
  "primary-fixed-dim": color.yellow,
  "on-tertiary-fixed": "#4f4d26",
  "on-primary-container": color.navy,
  "surface-container-high": "#F1F3F5",
  "tertiary-container": "#fef8c3",
  "secondary-fixed-dim": "#ffb19a",
  "surface-container": "#F1F3F5",
  "primary-container": color.yellow,
  "on-secondary-fixed": "#651900",
  "outline-variant": "#CED4DA",
  "surface-variant": color.surfaceSubtle,
  "on-primary": color.navy,
  "surface-bright": color.surface,
  "inverse-primary": color.yellow,
  // Keys expected by the Expo-template themed components (themed-text, collapsible)
  "text": color.ink,
  "icon": color.slateMuted,
};

export const Colors = {
  light,
  // Dark mode is not a supported surface yet; mirror light so nothing breaks.
  dark: light,
};

export const Fonts = {
  rounded: font.semibold,
  mono: Platform.OS === 'ios' ? 'Courier' : 'monospace',
};

export const Typography = {
  fontFamily: {
    headline: font.bold,
    body: font.regular,
    label: font.semibold,
  },
};

export default {
  Colors,
  Typography,
};
