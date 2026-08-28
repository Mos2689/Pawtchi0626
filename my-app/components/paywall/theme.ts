/**
 * The paywall's V2 palette and type aliases, shared by both presentations.
 *
 * Lifted verbatim out of app/paywall.tsx when the screen was split into
 * StandardPaywall and WinbackPaywall. Values are unchanged — the win-back
 * screen has to look like the same product at a different price, and a second
 * copy of these constants drifting a hex is exactly how that stops being true.
 *
 * The palette is white ground / navy text / yellow accent. NAVY here is the
 * paywall's own #0a1a3a rather than `color.navy` (#07202A) from the design
 * system; that difference predates this split and is preserved deliberately.
 */

import { color, font } from '../../constants/design';

export const NAVY = '#0a1a3a';
export const YELLOW = color.yellow;
export const GRAY_500 = '#6b7280';
export const GRAY_400 = '#9ca3af';
export const CHIP_BG = '#f8f8f6';
export const CHIP_BORDER = '#e5e5e0';
export const TESTIMONIAL_BG = '#fafaf7';
export const TESTIMONIAL_BORDER = '#ececea';

export const DISPLAY = font.display;
export const BODY = font.regular;
export const BODY_MED = font.medium;
export const BODY_SEMI = font.semibold;
export const BODY_BOLD = font.bold;
export const BODY_XB = font.extrabold;
