import {
  TEXT_FIELD_INPUT_LAYOUT,
  TEXT_FIELD_MAX_FONT_SCALE,
  textFieldInputStyle,
  textFieldWrapperLayout,
} from './textFieldLayout';

describe('single-line text field layout', () => {
  test('the wrapper owns the centring', () => {
    const wrapper = textFieldWrapperLayout(56);
    expect(wrapper.flexDirection).toBe('row');
    expect(wrapper.alignItems).toBe('center');
  });

  test('the input is never given a height', () => {
    // Rule one, stated as a test. Every early fix kept `height` on the
    // TextInput and argued about the rest; that is the thing that does not work.
    expect(TEXT_FIELD_INPUT_LAYOUT).not.toHaveProperty('height');
    expect(TEXT_FIELD_INPUT_LAYOUT).not.toHaveProperty('minHeight');
    expect(TEXT_FIELD_INPUT_LAYOUT).not.toHaveProperty('maxHeight');
  });

  test('the input has no lineHeight', () => {
    // On iOS a lineHeight on a TextInput moves the baseline inside the line box
    // instead of growing it, which drops the glyphs toward the bottom edge —
    // the exact symptom this module exists to prevent.
    expect(TEXT_FIELD_INPUT_LAYOUT).not.toHaveProperty('lineHeight');
  });

  test('the input neutralises the padding that decentres the glyphs', () => {
    expect(TEXT_FIELD_INPUT_LAYOUT.paddingVertical).toBe(0);
    expect(TEXT_FIELD_INPUT_LAYOUT.includeFontPadding).toBe(false);
    expect(TEXT_FIELD_INPUT_LAYOUT.textAlignVertical).toBe('center');
  });

  test('the input fills the wrapper so leading and trailing content can sit beside it', () => {
    expect(TEXT_FIELD_INPUT_LAYOUT.flex).toBe(1);
  });
});

// Rule two. The centring in rule one is correct and still cannot save a box
// that is shorter than its own text — and a fixed height plus scalable type
// guarantees that case exists on somebody's device. These are the tests that
// make the difference between "fixed at the default text size" and fixed.
describe('the box can always contain its text', () => {
  test('the wrapper height is a minimum, not a fixed size', () => {
    const wrapper = textFieldWrapperLayout(56);
    expect(wrapper.minHeight).toBe(56);
    expect(wrapper).not.toHaveProperty('height');
    expect(wrapper).not.toHaveProperty('maxHeight');
  });

  test('a grown field keeps room above and below the glyphs', () => {
    expect(textFieldWrapperLayout(56).paddingVertical).toBeGreaterThan(0);
  });

  test('font scaling is capped, but not switched off', () => {
    // 1 would mean the field ignores the OS text-size setting entirely, which
    // trades this bug for an accessibility one.
    expect(TEXT_FIELD_MAX_FONT_SCALE).toBeGreaterThan(1);
    expect(TEXT_FIELD_MAX_FONT_SCALE).toBeLessThanOrEqual(1.5);
  });
});

// The hole the original test could not see: the rule lived in a constant, but
// the component applied the caller's `inputStyle` after it, so any call site
// could silently win. Guarding the constant proved nothing about the pixels.
describe('a caller cannot override the layout invariant', () => {
  const typeStyle = { fontFamily: 'Montserrat_500Medium', color: '#000' };

  test('the invariant is applied last', () => {
    const composed = textFieldInputStyle(typeStyle, 16, { fontFamily: 'X' } as never);
    expect(composed[composed.length - 1]).toBe(TEXT_FIELD_INPUT_LAYOUT);
  });

  test('the caller can still restyle the type', () => {
    const composed = textFieldInputStyle(typeStyle, 16, { fontFamily: 'X' } as never);
    // Type sits before the caller's override, so the caller wins on family.
    expect(composed.indexOf(typeStyle as never)).toBeLessThan(2);
    expect(composed).toContainEqual({ fontFamily: 'X' });
  });

  test('a caller-supplied height loses to the invariant', () => {
    const composed = textFieldInputStyle(typeStyle, 16, { height: 56 } as never);
    const callerIndex = composed.findIndex(
      (s) => !!s && typeof s === 'object' && 'height' in (s as object),
    );
    expect(callerIndex).toBeGreaterThan(-1);
    expect(composed.indexOf(TEXT_FIELD_INPUT_LAYOUT)).toBeGreaterThan(callerIndex);
  });

  test('fontSize is applied and remains overridable by the caller', () => {
    const composed = textFieldInputStyle(typeStyle, 18, undefined);
    expect(composed).toContainEqual({ fontSize: 18 });
  });
});
