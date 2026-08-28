/**
 * The vertical-centring rule for single-line text fields, as data.
 *
 * This exists because the pet-name field's placeholder sat low in its box and
 * was "fixed" many times over, each fix a different theory about how React
 * Native centres a single-line input: a parent's `justifyContent`;
 * `height: '100%'`; `textAlignVertical` alone; a height built from
 * `paddingVertical`; then no height at all with `padding: 0`, which clipped the
 * text. Every one of them kept the height ON the TextInput and argued about the
 * rest.
 *
 * Rule one, and it was already working in two places in this app the whole time:
 *
 *   • components/BreedPickerModal.tsx — its search field puts the height on the
 *     wrapping View with `alignItems: 'center'`, and gives the TextInput
 *     `flex: 1`, `paddingVertical: 0`, `includeFontPadding: false`.
 *   • app/onboarding/identity.tsx — the Breed row, a Text inside a centred
 *     wrapper, "always looked right" (its own comment says so).
 *
 * So: a single-line TextInput must never be given a height. Let it size to its
 * own content and let flexbox centre it. Asking the input to centre text inside
 * a height you handed it is the thing that does not work reliably, because what
 * it centres is the font's padded line box — and for a font with asymmetric
 * vertical metrics (Montserrat's are) that box is not centred on the glyphs.
 *
 * ── Rule two, which is why rule one alone kept regressing ────────────────────
 *
 * Rule one centres the text inside the box. It cannot help when the text is
 * TALLER than the box, and a fixed `height` guarantees that eventually it will
 * be: `allowFontScaling` defaults to true, so iOS Dynamic Type and Android font
 * size scale the glyphs while a hardcoded 56 does not move. Past the crossover
 * the line box overflows a container it cannot grow, and with Montserrat's
 * descenders the overflow reads as text bleeding out of the bottom edge.
 *
 * That is also why the fix never seemed to hold. At the default text size every
 * one of these fixes is correct and looks perfect, so it ships; on a device
 * with larger text it was never fixed at all. Two people looking at the same
 * build disagree about whether the bug exists, and the loop repeats.
 *
 * So the box is a MINIMUM, never a fixed height, and the scaling is capped so a
 * grown field stays a field instead of a paragraph. A fixed-height box holding
 * scalable text is the bug; this removes the shape of it rather than the
 * instance.
 *
 * Kept free of React Native and design-token imports so the invariants can be
 * asserted under jest. See textFieldLayout.test.ts — that test is the thing
 * that makes this permanent rather than another comment nobody reads.
 */

/**
 * How far the field's type may grow with the OS text-size setting.
 *
 * Not 1 — refusing to scale at all is an accessibility regression, and it is
 * also how you get a field nobody with low vision can read. 1.3 keeps the
 * largest standard Dynamic Type sizes legible while the row stays a row.
 */
export const TEXT_FIELD_MAX_FONT_SCALE = 1.3;

/** Breathing room kept above and below the glyphs once the box has to grow. */
const GROWN_FIELD_PADDING = 10;

/**
 * Layout the WRAPPER owns: the box, and the centring.
 *
 * `minHeight`, not `height` — see rule two. At the default text size the
 * minimum is the whole story and the field looks exactly as it always has; the
 * box only grows on devices where it otherwise would have clipped.
 */
export function textFieldWrapperLayout(minHeight: number): {
  minHeight: number;
  flexDirection: 'row';
  alignItems: 'center';
  paddingVertical: number;
} {
  return {
    minHeight,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: GROWN_FIELD_PADDING,
  };
}

/**
 * Layout the INPUT owns. Deliberately has no `height` key, and must not gain
 * one — that is rule one.
 *
 * No `lineHeight` either. On iOS a lineHeight on a TextInput repositions the
 * baseline inside the line box rather than growing it, which puts the glyphs
 * low in exactly the way this whole module exists to prevent.
 */
export const TEXT_FIELD_INPUT_LAYOUT = {
  flex: 1,
  paddingVertical: 0,
  includeFontPadding: false,
  textAlignVertical: 'center',
} as const;

/**
 * Compose the input's final style array.
 *
 * The order is the point. `TEXT_FIELD_INPUT_LAYOUT` goes LAST so that a caller
 * passing `inputStyle` can restyle the type — family, colour, weight, which is
 * all any caller has ever wanted — but cannot reintroduce a height, a padding
 * or a lineHeight by accident. Before this, `inputStyle` was applied after the
 * invariant and silently won, which left the rule enforceable only by everyone
 * remembering it.
 *
 * Typed loosely on purpose: this module stays free of React Native imports so
 * the ordering can be asserted in a plain unit test.
 */
export function textFieldInputStyle<TypeStyle, CallerStyle>(
  typeStyle: TypeStyle,
  fontSize: number,
  callerStyle: CallerStyle,
): (TypeStyle | CallerStyle | { fontSize: number } | typeof TEXT_FIELD_INPUT_LAYOUT)[] {
  return [typeStyle, { fontSize }, callerStyle, TEXT_FIELD_INPUT_LAYOUT];
}
