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
  alert: '#d97706',
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

// Exactly two elevation recipes. Pick one; do not invent a third.
export const shadow = {
  card: {
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 3,
  },
  raised: {
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 6,
  },
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
