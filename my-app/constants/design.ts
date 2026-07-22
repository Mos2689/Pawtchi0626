// ─────────────────────────────────────────────────────────────────────────────
// Pawtchi design tokens — the single source of truth for every design value.
// (Pawtchi Brand Book 2026, Part IV. Two surfaces: navy "brand moments" and
// warm light "operational" screens — one font pair, one yellow, shared scales.)
//
// Rules of the road:
//  • Never hardcode a hex, radius, or font string in a screen — import from here.
//  • Yellow marks the ONE thing that matters per surface (§4.02): the CTA.
//  • Semantic colors are for data states only, never marketing urgency.
//  • Motion pulls from `motion` below — never hand-tune a duration or spring.
// ─────────────────────────────────────────────────────────────────────────────
// NOTE: this module stays pure data (no reanimated import) so it can be consumed
// by logic/lib code under ts-jest. Easing *functions* live with their call sites.
// The one exception is `Platform` (from react-native) used by `makeShadow` below.
// This module is pulled into the ts-jest suite transitively (via
// lib/vetReport/buildVetReportHTML), so react-native is mapped to a Node stub at
// lib/__mocks__/react-native.ts through jest.moduleNameMapper — extend that stub
// if you import more of react-native here.

import { Platform } from 'react-native';

export const color = {
  // Brand ground (navy surface)
  navy: '#07202A',
  navyRaised: '#0B2A36',
  cream: '#F4F1EC',
  creamDim: 'rgba(244, 241, 236, 0.66)',
  creamFaint: 'rgba(244, 241, 236, 0.42)',
  hairlineOnNavy: 'rgba(244, 241, 236, 0.14)',

  // The one yellow (brand electric)
  yellow: '#F7F602',
  yellowSoft: 'rgba(247, 246, 2, 0.14)',

  // Operational ground (light surface)
  surface: '#FFFFFF',
  surfaceSubtle: '#F8F7F4', // warm paper, not gray
  hairline: '#eef2f6',

  // Text on light
  ink: '#0f172a',
  slate: '#475569',
  slateMuted: '#64748b',
  slateFaint: '#94a3b8',
  track: '#f1f5f9',

  // Semantic — data states only
  success: '#16a34a',
  successSoft: 'rgba(22, 163, 74, 0.10)',
  alert: '#d97706',
  alertSoft: 'rgba(217, 119, 6, 0.10)',
  alertDeep: '#92400e',
  error: '#dc2626',
  errorSoft: '#fef2f2',

  // Data-viz (rings, charts) — distinct from UI accents on purpose
  viz: {
    calories: '#f97316',
    move: '#F7F602',
    hydrate: '#3091F9',
    amber: '#FFC400',
    green: '#4ade80',
    purple: '#c084fc',
  },

  // Social artifacts (Paw Moment cards) — "Two lines, one walk", the card
  // identity locked 2026-07-10: light paper grounds, the human's path in warm
  // ink, the dog's path in a deepened Pawtchi yellow. These tokens exist only
  // for shareable surfaces (cards that leave the app); do not reach for them
  // in app chrome, and do not swap the deepened yellow for the electric app
  // yellow — #F7F602 does not hold on white.
  moment: {
    paper: '#FCFBF7',        // plain ground
    paperMap: '#FBF9F4',     // ground under the washed map
    paperWash: 'rgba(251, 249, 244, 0.72)', // wash that quiets the basemap
    ink: '#2E2B26',          // warm charcoal — owner line + primary text
    inkSoft: '#6F6A60',      // secondary text, headline
    inkFaint: '#A9A498',     // captions, units, place label
    hairline: '#E9E4D8',     // rules
    yellow: '#F2CC0F',       // the dog's line — deepened for light grounds
    yellowOnPhoto: '#F7F602', // electric brand yellow — only over the dark photo scrim, never on white
    onPhoto: '#FFFFFF',      // lockup on the photo ground
    onPhotoSoft: 'rgba(255, 255, 255, 0.78)',
    onPhotoFaint: 'rgba(255, 255, 255, 0.6)',
    photoScrim: 'rgba(20, 18, 14, 0.30)', // flat legibility wash behind photo lockup
  },
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  pill: 999,
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

// Shadows are platform-split in React Native. iOS honors the `shadow*` props
// (soft, tinted, blurred). Android ignores them and draws only `elevation` — the
// harsh, neutral-gray Material shadow that made our cards look "off". Since the
// app runs the New Architecture (newArchEnabled), Android supports the modern
// cross-platform `boxShadow` string, which renders a soft, color-tinted shadow
// that matches the iOS look. So: iOS keeps its exact `shadow*` props, Android
// gets an equivalent `boxShadow`. Use this helper anywhere you'd reach for
// `elevation` — never hand-write a raw `elevation` again.
const hexToRgb = (hex: string) => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
};

export const makeShadow = (
  y: number,
  blur: number,
  opacity: number,
  color = '#0f172a',
) =>
  Platform.OS === 'android'
    ? {
        boxShadow: `0px ${y}px ${blur}px rgba(${
          color.startsWith('#') ? hexToRgb(color) : color
        }, ${opacity})`,
      }
    : {
        shadowColor: color,
        shadowOffset: { width: 0, height: y },
        shadowOpacity: opacity,
        shadowRadius: blur,
      };

// Exactly two elevation recipes. Pick one; do not invent a third.
export const shadow = {
  card: makeShadow(4, 12, 0.05),
  raised: makeShadow(8, 20, 0.08),
} as const;

// Android ignores `fontWeight` with custom fonts, so each weight is its own
// family file. Use these — never a `fontWeight` next to a custom family.
export const font = {
  display: 'BebasNeue_400Regular',
  regular: 'Montserrat_400Regular',
  medium: 'Montserrat_500Medium',
  semibold: 'Montserrat_600SemiBold',
  bold: 'Montserrat_700Bold',
  extrabold: 'Montserrat_800ExtraBold',
  // Social-artifact type (Paw Moment cards only) — quiet, editorial Inter.
  // Weight-per-family, same as Montserrat.
  momentRegular: 'Inter_400Regular',
  momentMedium: 'Inter_500Medium',
  momentSemibold: 'Inter_600SemiBold',
  momentBold: 'Inter_700Bold',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Motion language — one restrained, tactile feel app-wide. Pull durations,
// springs and press-scales from here; never hand-tune a screen.
//   • `duration` — milliseconds for timing-based animations.
//   • `spring`   — withSpring configs; `press` for taps, `bouncy` for entrances
//                  / coin bounce, `gentle` for layout shifts.
//   • `scale`    — the rest-state scale a pressed surface springs down to.
// For value-sweep easing use `Easing.out(Easing.cubic)` (the "standard" curve)
// — kept at call sites so this module imports no reanimated runtime.
// ─────────────────────────────────────────────────────────────────────────────
export const motion = {
  duration: { instant: 120, fast: 180, base: 260, slow: 420, ring: 900 },
  spring: {
    press: { damping: 18, stiffness: 320, mass: 0.7 },
    bouncy: { damping: 12, stiffness: 220, mass: 0.8 },
    gentle: { damping: 20, stiffness: 160 },
  },
  scale: { press: 0.96, chip: 0.94 },
  // The Living Paw loader — breathing is the continuous "working" signal;
  // the heartbeat fires exactly once, on successful completion. Timeline
  // shape (escalation, cycles) lives in lib/loaderTimeline.ts.
  loader: {
    breatheCycle: 4500,
    breatheScale: 1.006,
    heartbeatScale: 1.03,
    copyRotate: 1700,
    minVisibleDelay: 400,
    resolve: 420,
  },
} as const;

// Type scale — size/lineHeight/family presets. Spread into styles:
//   { ...type.title, color: color.ink }
export const type = {
  display: { fontFamily: font.display, fontSize: 40, lineHeight: 40, letterSpacing: 1 },
  displayLg: { fontFamily: font.display, fontSize: 52, lineHeight: 50, letterSpacing: 1 },
  title: { fontFamily: font.bold, fontSize: 22, lineHeight: 28, letterSpacing: -0.3 },
  heading: { fontFamily: font.bold, fontSize: 17, lineHeight: 22, letterSpacing: -0.2 },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 22 },
  bodyMedium: { fontFamily: font.medium, fontSize: 15, lineHeight: 22 },
  label: { fontFamily: font.semibold, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: font.semibold, fontSize: 11.5, lineHeight: 14, letterSpacing: 1.2 },
} as const;
