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

export const BRAND_YELLOW = '#F4F600' as const;

export const brandYellowAlpha = (opacity: number) =>
  `rgba(244, 246, 0, ${opacity})`;

export const color = {
  // Brand ground (navy surface)
  navy: '#07202A',
  navyRaised: '#0B2A36',
  cream: '#F4F1EC',
  creamDim: 'rgba(244, 241, 236, 0.66)',
  creamFaint: 'rgba(244, 241, 236, 0.42)',
  hairlineOnNavy: 'rgba(244, 241, 236, 0.14)',

  // The one yellow (brand electric)
  yellow: BRAND_YELLOW,
  yellowSoft: brandYellowAlpha(0.14),

  // ── Electric blue — the Walk Home exception ────────────────────────────────
  // A sanctioned, explicitly-approved third colour, introduced with the
  // walk-first Home redesign (design 4a). It carries *discovery and identity*
  // signals only: the Walksign name, the record button's inner glyph, and the
  // sniff-stop count (the one walk stat that is about curiosity, not effort).
  //
  // It is NOT a second CTA colour. Yellow still marks the one thing that
  // matters per surface; blue never fills a button, never carries body text,
  // and never appears on the navy ground. Reach for it only when the thing
  // being marked is something the dog *found*.
  electric: '#144EFF',
  electricSoft: 'rgba(20, 78, 255, 0.10)',

  // Operational ground (light surface)
  surface: '#FFFFFF',
  surfaceSubtle: '#F8F7F4', // warm paper, not gray
  hairline: '#eef2f6',

  // A light wash that quiets a raster basemap behind app chrome (Home's map
  // canopy on Android, where OSM tiles are images and individual features can't
  // be styled away the way Apple Maps' POIs can). Deliberately far lighter than
  // `moment.paperWash`: this one has to keep the streets readable, not reduce
  // the map to a texture behind a share card.
  basemapWash: 'rgba(255, 255, 255, 0.30)',

  // ── Map markers ────────────────────────────────────────────────────────────
  // Pastels for pins dropped ON the basemap, and only there. They are the
  // quietest colours in the system by design: a marker has to be findable
  // against pale roads and parkland without competing with the yellow CTA, so
  // these carry category (which walk, which spot) and never state or action.
  //
  // Assigned round-robin by index rather than by meaning — there is no
  // taxonomy of spot types to encode, and inventing one in colour would imply
  // a distinction the data does not make. `ink` is the selected marker.
  marker: {
    pink: '#F7C8D8',
    mint: '#C8E6D0',
    butter: '#FBE2A7',
    sky: '#C9DEFF',
    ink: '#0F172A',
    // The one saturated pin, and the one place a marker carries meaning rather
    // than category: a sniff stop on the selected walk's route.
    //
    // This is `color.electric` (#144EFF) — repeated as a literal only because
    // an object cannot reference its own sibling. It is the sanctioned use, not
    // an exception: the rule is to reach for electric when the thing being
    // marked is something the dog *found*, and the sniff count on a walk card
    // already uses it for exactly that reason. These pins are that stat's
    // geography.
    sniff: '#144EFF',
  },

  // ── Correspondence surface (Write to Founder) ──────────────────────────────
  // A white-ground, postal-themed surface with its own two-colour system. It is
  // scoped to the letter flow on purpose: this is the only place in the app
  // where a blue carries structural meaning, and letting it leak into the tabs
  // would put a third colour in competition with navy and yellow everywhere.
  //
  // Contrast rule carried over from the brand book: yellow does not hold as
  // *ink* on white. Use it only as a filled block behind navy text (the CTA,
  // the highlighter), never as text, hairlines, or thin marks on a white ground.
  letter: {
    yellow: BRAND_YELLOW,
    yellowSoft: brandYellowAlpha(0.16),
    accent: '#1447f1',       // structural blue — rules, stamp, chevrons
    accentSoft: 'rgba(20, 71, 241, 0.08)',
    accentInk: '#0E31A8',    // darkened blue for small text on white (AA)
    paper: '#FFFFFF',
    hairline: '#E8EAF2',
  },

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
    move: BRAND_YELLOW,
    hydrate: '#3091F9',
    amber: '#FFC400',
    green: '#4ade80',
    purple: '#c084fc',
  },

  // Social artifacts (Paw Moment cards) — "Two lines, one walk", the card
  // identity locked 2026-07-10: light paper grounds, the human's path in warm
  // ink, and the dog's path in Pawtchi's electric yellow. These tokens exist
  // only for shareable surfaces (cards that leave the app); do not reach for
  // them in app chrome.
  moment: {
    paper: '#FCFBF7',        // plain ground
    paperMap: '#FBF9F4',     // ground under the washed map
    paperWash: 'rgba(251, 249, 244, 0.72)', // wash that quiets the basemap
    ink: '#2E2B26',          // warm charcoal — owner line + primary text
    inkSoft: '#6F6A60',      // secondary text, headline
    inkFaint: '#A9A498',     // captions, units, place label
    hairline: '#E9E4D8',     // rules
    yellow: BRAND_YELLOW,        // the dog's line — the same electric brand yellow on every ground
    yellowOnPhoto: BRAND_YELLOW, // explicit alias keeps photo-ground intent readable
    sniff: '#144EFF',         // electric blue — a place the dog found
    onPhoto: '#FFFFFF',      // lockup on the photo ground
    onPhotoSoft: 'rgba(255, 255, 255, 0.78)',
    onPhotoFaint: 'rgba(255, 255, 255, 0.6)',
    photoScrim: 'rgba(20, 18, 14, 0.30)', // flat legibility wash behind photo lockup

    // Earned-template additions (moment card library). The gold is the
    // Signature card's ink — gilded, not brassy; it exists ONLY on the navy
    // ground and must never appear on paper (it reads muddy on white).
    gold: '#C9A227',
    // "Dusk" premium colorway — night ground with an amber line. Colorway
    // tokens live here so a colorway is a token-set swap, never a re-style.
    duskGround: '#101A22',
    duskLine: '#E8A87C',
    duskHairline: '#2A3540',
  },

  /**
   * The iOS walk Live Activity — the Lock Screen card and Dynamic Island.
   *
   * A paper ground with near-black ink, from the locked Walk Home direction
   * (design handoff, Aug 2026). Deliberately NOT `moment.*`: those tokens are
   * warm charcoal on warm paper, tuned for a keepsake someone screenshots and
   * shares. This card is read at arm's length, in one glance, often outdoors —
   * it needs the extra crispness of a neutral near-black.
   *
   * Colour discipline here is load-bearing and narrower than anywhere else in
   * the app: the route is INK, and `yellow` appears on the live pulse and the
   * head of the route and nowhere else. That restraint is the entire reason a
   * glance reads as "this is happening right now". `electric` marks discovery
   * on the finished card only.
   *
   * Mirrored in Swift at targets/walk-activity/PawtchiTheme.swift, which cannot
   * import TypeScript. These values are the source of truth; that file follows.
   */
  liveActivity: {
    // Pure white, and it must be painted as an OPAQUE FILL inside the card.
    // `activityBackgroundTint` alone only tints iOS's translucent material, so
    // the wallpaper reads through it — which looked like a bug on a dark
    // Lock Screen photo and was one.
    paper: '#FFFFFF',        // the card ground
    well: '#EAE7E0',         // the route trace's recessed panel
    ink: '#101014',          // type and the route line itself
    inkMuted: 'rgba(0, 0, 0, 0.55)',  // sub-copy, pill label
    inkFaint: 'rgba(0, 0, 0, 0.42)',  // eyebrows on the quieter states
    inkTrace: 'rgba(0, 0, 0, 0.28)',  // the route's start dot, pulse ring
    hairline: 'rgba(0, 0, 0, 0.10)',  // the stats-shelf rule
    border: 'rgba(0, 0, 0, 0.08)',    // state-card borders
    pillFill: 'rgba(0, 0, 0, 0.06)',  // the "Ends at home" geofence pill
    live: BRAND_YELLOW,      // the live pulse + route head. Nothing else.
    discovery: '#144EFF',    // = color.electric; the finished card's eyebrow
    cardFinished: '#FFFFFF', // the wrap-up goes white: a memory, not an alert
    // The Dynamic Island is system-black and paper never applies inside it.
    islandInk: '#FFFFFF',
    islandInkSoft: 'rgba(255, 255, 255, 0.62)',
    islandDivider: 'rgba(255, 255, 255, 0.22)',
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
  // ── Editorial serif — two surfaces, and no more ──
  // A fifth family, added deliberately and fenced tightly. It exists where a
  // walk is being presented as a page from the dog's biography rather than as
  // app chrome. A serif is what makes that read as editorial; none of the four
  // existing families can do it.
  //
  // Sanctioned surfaces:
  //   1. The full-page moment viewer (Walk Memory).
  //   2. The iOS walk Live Activity's dog name and wrap-up title (Aug 2026) —
  //      the design handoff specifies Instrument Serif there; this is the
  //      codebase's serif standing in for it, so the app ships one serif rather
  //      than two. Same editorial intent: a Lock Screen card about a walk that
  //      happened, not a control.
  //
  // It is NOT a general heading face. Screens, cards, buttons and every other
  // surface stay on Montserrat — reaching for this anywhere else turns a
  // deliberate exception into an inconsistent product.
  memoryTitle: 'PlayfairDisplay_500Medium',
  memoryTitleItalic: 'PlayfairDisplay_500Medium_Italic',

  // Social-artifact type (Paw Moment cards only) — quiet, editorial Inter.
  // Weight-per-family, same as Montserrat.
  momentRegular: 'Inter_400Regular',
  momentMedium: 'Inter_500Medium',
  momentSemibold: 'Inter_600SemiBold',
  momentBold: 'Inter_700Bold',
} as const;

// Bebas Neue is an all-caps display face whose glyphs fill — and slightly
// overflow — the em box. React Native centres the glyph in the line box and
// clips whatever spills, so any `lineHeight` at or below `fontSize` shears the
// tops off digits and caps. (This shipped twice: the health weight readout at
// 76/72 and the activity mission counter at 64/60.)
//
// 1.2 is the smallest ratio that clears the ascenders at every size we ship.
// `includeFontPadding: false` stops Android adding its own compensating pad on
// top, which would otherwise re-open the vertical-centring gap.
//
// Never hand-write a `lineHeight` next to `font.display` — spread this instead:
//
//   valueText: { ...displayLine(64), letterSpacing: 1, color: color.cream },
//
const DISPLAY_LINE_RATIO = 1.2;

export const displayLine = (size: number) => ({
  fontFamily: font.display,
  fontSize: size,
  lineHeight: Math.ceil(size * DISPLAY_LINE_RATIO),
  includeFontPadding: false,
});

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
  // Destination wayfinding — an indeterminate journey signal while a real
  // walking route is calculated, followed by one quick, conclusive settle.
  route: {
    travelCycle: 1350,
    resolve: 240,
    readyHold: 2200,
  },
  // The Success Ribbon — signature walk-finish transition. A flowing brand
  // ribbon is painted across the screen in a left→right→left wag; the walk
  // screen crossfades to the success screen underneath it (no flat cover); the
  // ribbon flows off and the content settles in. Clocks for the transition +
  // the summary reveal stagger; easings live at call sites / in the module.
  // Relaxed, unhurried pace — always plays fully.
  tailWhip: {
    anticipation: 120, //  press freeze before the ribbon draws
    sweep: 1100, //        the ribbon paints in, flows across, and off
    reveal: 260, //        per-block duration of the content stagger
    revealStagger: 40,
    uiShift: 2, //         secondary-motion nudge (px)
    particleFade: 400, //  fur-dust fade as the ribbon flows off
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
