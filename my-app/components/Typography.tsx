import React from 'react';
import { Text, TextProps, StyleSheet } from 'react-native';
import { Colors, Typography as ThemeTypography } from '../constants/Theme';

export type TextVariant = 'headline' | 'body' | 'label';
export type TextWeight = 'normal' | 'medium' | 'semibold' | 'bold' | 'extrabold';
export type TextColor = keyof typeof Colors.light;

interface TypographyProps extends TextProps {
  variant?: TextVariant;
  weight?: TextWeight;
  color?: TextColor;
  size?: number;
  align?: 'auto' | 'left' | 'right' | 'center' | 'justify';
}

export const Typography: React.FC<TypographyProps> = ({
  variant = 'body',
  weight = 'normal',
  color = 'on-background',
  size,
  align = 'auto',
  style,
  children,
  ...rest
}) => {
  const isDarkMode = false; // Add real hook later if needed
  const themeColors = isDarkMode ? Colors.dark : Colors.light;

  const getFontFamily = () => {
    // In a real app, you'd load font variants based on weight, e.g., 'PlusJakartaSans-Bold'
    // For now, we'll try to map it gracefully or just use the base family if weights aren't loaded explicitly as separate families
    return ThemeTypography.fontFamily[variant];
  };

  const getFontWeight = (): any => {
    switch (weight) {
      case 'medium': return '500';
      case 'semibold': return '600';
      case 'bold': return '700';
      case 'extrabold': return '800';
      default: return '400';
    }
  };

  const getDefaultSize = () => {
    switch(variant) {
      case 'headline': return 24;
      case 'label': return 14;
      case 'body':
      default: return 16;
    }
  };

  return (
    <Text
      style={[
        {
          fontFamily: getFontFamily(),
          fontWeight: getFontWeight(),
          color: themeColors[color] || themeColors['on-background'],
          fontSize: size || getDefaultSize(),
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
