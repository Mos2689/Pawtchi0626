import React from 'react';
import { Text, TextProps } from 'react-native';
import { color, font, type as typeScale } from '../constants/design';

// Brand text component. Weight maps to a Montserrat family file (Android
// ignores fontWeight with custom fonts), variant maps to the type scale.
// Public API kept compatible with the previous version.

export type TextVariant = 'display' | 'headline' | 'title' | 'heading' | 'body' | 'label' | 'caption';
export type TextWeight = 'normal' | 'medium' | 'semibold' | 'bold' | 'extrabold';

interface TypographyProps extends TextProps {
  variant?: TextVariant;
  weight?: TextWeight;
  color?: string;
  size?: number;
  align?: 'auto' | 'left' | 'right' | 'center' | 'justify';
}

const WEIGHT_FAMILY: Record<TextWeight, string> = {
  normal: font.regular,
  medium: font.medium,
  semibold: font.semibold,
  bold: font.bold,
  extrabold: font.extrabold,
};

const VARIANT_PRESET: Record<TextVariant, { fontFamily: string; fontSize: number; lineHeight?: number; letterSpacing?: number }> = {
  display: typeScale.display,
  headline: typeScale.title, // legacy alias
  title: typeScale.title,
  heading: typeScale.heading,
  body: typeScale.body,
  label: typeScale.label,
  caption: typeScale.caption,
};

// Older screens pass Material-style token names from the deprecated Theme.ts.
// Resolve them to brand colors so those screens render correctly until they're
// migrated to direct `color.*` imports.
const LEGACY_COLOR: Record<string, string> = {
  'on-surface': color.ink,
  'on-background': color.ink,
  'on-surface-variant': color.slateMuted,
  'on-primary': color.navy,
  'on-primary-container': color.navy,
  'on-tertiary-container': color.slate,
  'primary': color.yellow,
  'primary-fixed-dim': color.alert,
  'inverse-on-surface': color.slateFaint,
};

function resolveColor(c?: string): string {
  if (!c) return color.ink;
  return LEGACY_COLOR[c] ?? c;
}

export const Typography: React.FC<TypographyProps> = ({
  variant = 'body',
  weight,
  color: textColor,
  size,
  align = 'auto',
  style,
  children,
  ...rest
}) => {
  const preset = VARIANT_PRESET[variant];
  // Bebas has a single weight; otherwise an explicit weight overrides the preset family.
  const fontFamily =
    variant === 'display' ? font.display : weight ? WEIGHT_FAMILY[weight] : preset.fontFamily;

  return (
    <Text
      style={[
        {
          fontFamily,
          fontSize: size ?? preset.fontSize,
          lineHeight: size ? undefined : preset.lineHeight,
          letterSpacing: preset.letterSpacing,
          color: resolveColor(textColor),
          textAlign: align,
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </Text>
  );
};

export default Typography;
