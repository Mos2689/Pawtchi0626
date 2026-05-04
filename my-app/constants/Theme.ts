import { Platform } from 'react-native';

/**
 * Extracted colors from Stitch HTML Tailwind config.
 */
export const Colors = {
  light: {
    "surface-tint": "#755700",
    "outline": "#6c7980",
    "on-primary-fixed-variant": "#604700",
    "surface-container-low": "#F8F9FA",
    "on-tertiary-container": "#625f36",
    "on-secondary-fixed-variant": "#972900",
    "background": "#FFFFFF",
    "primary-dim": "#D9D600",
    "on-tertiary": "#faf5c0",
    "primary": "#FFFC00",
    "inverse-on-surface": "#929fa6",
    "error": "#b02500",
    "error-dim": "#b92902",
    "on-error": "#ffefec",
    "tertiary-fixed-dim": "#f0eab6",
    "secondary-container": "#ffc4b3",
    "tertiary-fixed": "#fef8c3",
    "primary-fixed": "#FFFC00",
    "on-surface-variant": "#515d64",
    "inverse-surface": "#041015",
    "on-primary-fixed": "#000000",
    "tertiary-dim": "#54512a",
    "surface-dim": "#E9ECEF",
    "on-background": "#1A1C1E",
    "on-secondary": "#ffefeb",
    "on-tertiary-fixed-variant": "#6d6940",
    "secondary-dim": "#952800",
    "error-container": "#f95630",
    "surface": "#FFFFFF",
    "secondary-fixed": "#ffc4b3",
    "surface-container-highest": "#DEE2E6",
    "secondary": "#a83206",
    "on-error-container": "#520c00",
    "on-surface": "#1A1C1E",
    "on-secondary-container": "#862400",
    "tertiary": "#605d34",
    "surface-container-lowest": "#FFFFFF",
    "primary-fixed-dim": "#E6E300",
    "on-tertiary-fixed": "#4f4d26",
    "on-primary-container": "#000000",
    "surface-container-high": "#F1F3F5",
    "tertiary-container": "#fef8c3",
    "secondary-fixed-dim": "#ffb19a",
    "surface-container": "#F1F3F5",
    "primary-container": "#FFFC00",
    "on-secondary-fixed": "#651900",
    "outline-variant": "#CED4DA",
    "surface-variant": "#F8F9FA",
    "on-primary": "#000000",
    "surface-bright": "#FFFFFF",
    "inverse-primary": "#FFFC00"
  },
  dark: {
    // Stitch didn't provide complete dark mode tokens in the excerpt, 
    // defaulting to light mode values or you can redefine them later
    "surface-tint": "#755700",
    "outline": "#6c7980",
    "on-primary-fixed-variant": "#604700",
    "surface-container-low": "#1A1C1E", // changed for dark
    "on-tertiary-container": "#625f36",
    "on-secondary-fixed-variant": "#972900",
    "background": "#121212", // changed for dark
    "primary-dim": "#D9D600",
    "on-tertiary": "#faf5c0",
    "primary": "#FFFC00",
    "inverse-on-surface": "#929fa6",
    "error": "#b02500",
    "error-dim": "#b92902",
    "on-error": "#ffefec",
    "tertiary-fixed-dim": "#f0eab6",
    "secondary-container": "#ffc4b3",
    "tertiary-fixed": "#fef8c3",
    "primary-fixed": "#FFFC00",
    "on-surface-variant": "#CED4DA", // changed
    "inverse-surface": "#041015",
    "on-primary-fixed": "#000000",
    "tertiary-dim": "#54512a",
    "surface-dim": "#2D2D2D",
    "on-background": "#FFFFFF", // changed
    "on-secondary": "#ffefeb",
    "on-tertiary-fixed-variant": "#6d6940",
    "secondary-dim": "#952800",
    "error-container": "#f95630",
    "surface": "#121212", // changed
    "secondary-fixed": "#ffc4b3",
    "surface-container-highest": "#404040", // changed
    "secondary": "#a83206",
    "on-error-container": "#520c00",
    "on-surface": "#FFFFFF", // changed
    "on-secondary-container": "#862400",
    "tertiary": "#605d34",
    "surface-container-lowest": "#000000",
    "primary-fixed-dim": "#E6E300",
    "on-tertiary-fixed": "#4f4d26",
    "on-primary-container": "#000000",
    "surface-container-high": "#2D2D2D",
    "tertiary-container": "#fef8c3",
    "secondary-fixed-dim": "#ffb19a",
    "surface-container": "#2D2D2D",
    "primary-container": "#FFFC00",
    "on-secondary-fixed": "#651900",
    "outline-variant": "#515d64", // changed
    "surface-variant": "#2D2D2D", // changed
    "on-primary": "#000000",
    "surface-bright": "#404040",
    "inverse-primary": "#FFFC00"
  }
};

export const Fonts = {
  rounded: 'Plus Jakarta Sans',
  mono: Platform.OS === 'ios' ? 'Courier' : 'monospace',
};

export const Typography = {
  fontFamily: {
    headline: 'Plus Jakarta Sans', // Ensure loaded in app setup
    body: 'Plus Jakarta Sans',
    label: 'Plus Jakarta Sans',
  },
};

export default {
  Colors,
  Typography,
}
