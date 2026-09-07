/**
 * How tall the auth screen's hero photograph should be — Android only.
 *
 * ── The bug ─────────────────────────────────────────────────────────────────
 *
 * The auth screen was built to a fixed 380pt hero and a 60/64pt headline. On
 * iOS that lands inside the viewport with room to spare. On Android it does
 * not: the same content sums to roughly 920dp against a 780–850dp viewport,
 * so the screen scrolled on arrival. A sign-up screen that opens mid-scroll
 * reads as a page that did not finish loading, which is the opposite of the
 * first impression this screen exists to make.
 *
 * ── Why this is measured rather than a table of device sizes ────────────────
 *
 * The content block is not a fixed height. It changes with the mode toggle
 * (sign-up carries a three-line collection notice, sign-in carries a
 * forgot-password button), with the owner's font scale, and with translation.
 * A breakpoint table would be wrong for all three and would need revisiting
 * every time the copy changed.
 *
 * So the caller measures the content it actually rendered and this gives the
 * hero whatever is left. The photograph is a cover-fit crop with nothing
 * load-bearing in it, which makes it the right element to absorb the slack —
 * it is the only thing on the screen that can lose 100dp and still be correct.
 *
 * Clamped at both ends: below AUTH_HERO_MIN the crop stops reading as a scene
 * and the stat stack collides with the wordmark, and above AUTH_HERO_MAX we
 * would be enlarging the image past the size the design was drawn at. Outside
 * that band the screen is allowed to scroll — a very small device or a large
 * accessibility font scale is a case where scrolling is the honest answer, not
 * a squashed photograph.
 *
 * Pure and dependency-free so it can be tested without a renderer.
 */

/** The design's hero height, and what iOS uses unconditionally. */
export const AUTH_HERO_MAX = 380;

/**
 * The floor. Below this the 16:9-ish crop starts cutting the dog's head and
 * the absolutely-positioned stat stack (top: 125) runs out of room.
 */
export const AUTH_HERO_MIN = 236;

/**
 * While the keyboard is open the hero collapses to a brand band.
 *
 * The wordmark sits at `insets.top + 20` and still reads at this height; the
 * stat stack is clipped by the hero's `overflow: hidden`, which is fine
 * because it is decorative. Collapsing here is what lifts the password field
 * clear of the keyboard without needing to fight Android's own window resize.
 */
export const AUTH_HERO_COMPACT = 84;

/** `styles.hero.marginBottom` — the gap between the photo and the content. */
export const AUTH_HERO_GAP = 22;

/**
 * Used before the content has reported its height, on the very first frame.
 *
 * A third of the viewport is close enough to the measured answer on every
 * phone we have looked at that the correction on the second pass is a few
 * points rather than a visible jump.
 */
const FIRST_PASS_RATIO = 0.34;

export interface AuthHeroInput {
  /** Full window height in dp. The hero draws under the status bar. */
  windowHeight: number;
  /**
   * Measured height of the content block including its bottom padding and the
   * bottom safe-area inset, or null before the first layout pass.
   */
  contentHeight: number | null;
  keyboardOpen: boolean;
}

export function authHeroHeight({
  windowHeight,
  contentHeight,
  keyboardOpen,
}: AuthHeroInput): number {
  if (keyboardOpen) return AUTH_HERO_COMPACT;

  const wanted =
    contentHeight === null
      ? Math.round(windowHeight * FIRST_PASS_RATIO)
      : windowHeight - contentHeight - AUTH_HERO_GAP;

  return clamp(wanted, AUTH_HERO_MIN, AUTH_HERO_MAX);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return max;
  return Math.max(min, Math.min(max, Math.round(value)));
}

// ── The decorative stat stack ───────────────────────────────────────────────

/**
 * Where the stat stack starts, measured down from the wordmark.
 *
 * The design hard-codes `top: 125`, which works only at the 380pt hero. Once
 * the hero can be shorter that number has to be relative to something, and the
 * thing it is really relative to is the wordmark: 20 below the top inset, ~34
 * tall, then a 10pt breath.
 */
const WORDMARK_BLOCK = 20 + 34 + 10;

/** Breathing room kept between the last numeral and the hero's bottom edge. */
const STACK_BOTTOM_MARGIN = 24;

/**
 * The stack's height is `30 + 174 * scale`:
 *   - 30 is fixed — three 10pt uppercase labels, which never shrink because
 *     they are already at the floor of legibility.
 *   - 174 scales — three 40pt numeral line-boxes, three 6pt label margins and
 *     two 18pt gaps.
 */
const STACK_FIXED = 30;
const STACK_SCALABLE = 174;

/**
 * Never below this. Past it the numerals stop carrying the "product preview"
 * job they are on the screen to do, and it is better to let the stack overlap
 * the bottom fade a little further — which the design already does at full
 * height, where the stack runs to 329 inside a 380 hero.
 */
const MIN_STACK_SCALE = 0.55;

export interface AuthHeroOverlay {
  /** Absolute `top` for the stat stack. */
  top: number;
  /**
   * Multiplier for every scalable dimension in the stack — numeral size and
   * line height, icon box, label margin, inter-item gap.
   *
   * Exactly 1 at the design's 380pt hero, so this is a no-op until the hero
   * actually has to give something up.
   */
  scale: number;
}

/**
 * Re-composes the hero's stat overlay for whatever height the hero ended up.
 *
 * Scaling the whole stack uniformly is what keeps this honest: a 23pt numeral
 * in a 265pt hero is the same fraction of the frame as a 34pt numeral in a
 * 380pt one, so it is the same composition rather than a different one.
 */
export function authHeroOverlay(input: {
  heroHeight: number;
  topInset: number;
}): AuthHeroOverlay {
  const top = input.topInset + WORDMARK_BLOCK;
  const band = input.heroHeight - top - STACK_BOTTOM_MARGIN;
  const scale = (band - STACK_FIXED) / STACK_SCALABLE;

  return {
    top: Math.round(top),
    scale: Number.isFinite(scale) ? Math.max(MIN_STACK_SCALE, Math.min(1, scale)) : 1,
  };
}
