/**
 * TextField — the app's single-line text input.
 *
 * Use this instead of a bare `TextInput` with a height on it. The vertical
 * centring rule it encodes, and the six failed attempts that produced it, are
 * documented in lib/ui/textFieldLayout.ts.
 *
 * The short version: the box height belongs to the wrapping View, which centres
 * with flexbox. The TextInput itself never gets a height. If you find yourself
 * adding one here, or overriding `inputStyle` with a height, that is the
 * regression coming back.
 *
 * Multiline inputs are a different problem (they want `textAlignVertical: 'top'`
 * and a real height) and deliberately do not use this component.
 */

import React from 'react';
import {
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { color, font, radius, space } from '../../constants/design';
import {
  TEXT_FIELD_MAX_FONT_SCALE,
  textFieldInputStyle,
  textFieldWrapperLayout,
} from '../../lib/ui/textFieldLayout';

/**
 * The app's standard field height. Matches the Breed row beside it.
 *
 * A minimum, not a fixed size — the box grows if the OS text setting makes the
 * type taller than this. See lib/ui/textFieldLayout.ts, rule two.
 */
export const TEXT_FIELD_HEIGHT = 56;

export interface TextFieldProps extends Omit<TextInputProps, 'style' | 'multiline'> {
  /** Box height. Only the WRAPPER is sized — see the module note above. */
  height?: number;
  fontSize?: number;
  /** Paints the border in the error tone. Copy is the caller's business. */
  error?: boolean;
  /** Rendered inside the box, before the input (a search glyph, a unit). */
  leading?: React.ReactNode;
  /** Rendered inside the box, after the input (a clear button, a suffix). */
  trailing?: React.ReactNode;
  /** Outer box: margins, width, a caller's own background. */
  containerStyle?: StyleProp<ViewStyle>;
  /** Type only — colour, family, size. A height here defeats the component. */
  inputStyle?: StyleProp<TextStyle>;
}

export function TextField({
  height = TEXT_FIELD_HEIGHT,
  fontSize = 16,
  error = false,
  leading,
  trailing,
  containerStyle,
  inputStyle,
  placeholderTextColor = color.slateFaint,
  ...inputProps
}: TextFieldProps) {
  return (
    <View
      style={[
        styles.wrap,
        textFieldWrapperLayout(height),
        error && styles.wrapError,
        containerStyle,
      ]}
    >
      {leading}
      <TextInput
        // Before the spread, so a caller can still opt out per field.
        maxFontSizeMultiplier={TEXT_FIELD_MAX_FONT_SCALE}
        {...inputProps}
        placeholderTextColor={placeholderTextColor}
        // Composed by the layout module, which puts the invariant last so
        // `inputStyle` can restyle the type without reintroducing a height.
        style={textFieldInputStyle(styles.inputType, fontSize, inputStyle)}
      />
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.hairline,
    paddingHorizontal: space.lg,
    gap: space.sm,
  },
  wrapError: {
    borderColor: color.error,
  },
  // Type only. The layout half lives in TEXT_FIELD_INPUT_LAYOUT and is applied
  // after `inputStyle` so it cannot be overridden — a height here is the
  // regression coming back.
  inputType: {
    fontFamily: font.medium,
    color: color.ink,
  },
});
