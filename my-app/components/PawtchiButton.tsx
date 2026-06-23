import React from 'react';
import { Text, StyleSheet, ActivityIndicator, ViewStyle, TextStyle, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { color, font, radius } from '../constants/design';
import { AnimatedPressable } from './AnimatedPressable';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'black';
export type ButtonSize = 'large' | 'medium' | 'small';

interface PawtchiButtonProps {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle | ViewStyle[];
  textStyle?: TextStyle | TextStyle[];
  iconName?: keyof typeof MaterialIcons.glyphMap;
  iconPosition?: 'left' | 'right';
  activeOpacity?: number;
}

export const PawtchiButton: React.FC<PawtchiButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  size = 'large',
  disabled = false,
  loading = false,
  style,
  textStyle,
  iconName,
  iconPosition = 'left',
  activeOpacity = 0.8,
}) => {
  const getBackgroundStyle = () => {
    switch (variant) {
      case 'primary': return { backgroundColor: color.yellow };
      case 'secondary': return { backgroundColor: color.track };
      case 'black': return { backgroundColor: color.navy };
      case 'outline': return { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: color.navy };
      case 'ghost': return { backgroundColor: 'transparent' };
      default: return { backgroundColor: color.yellow };
    }
  };

  const getTextStyle = () => {
    switch (variant) {
      case 'primary': return { color: color.navy };
      case 'secondary': return { color: color.ink };
      case 'black': return { color: color.yellow };
      case 'outline': return { color: color.navy };
      case 'ghost': return { color: color.slateMuted };
      default: return { color: color.navy };
    }
  };

  // Fixed heights give every CTA in the app the same physical presence.
  const getSizeStyle = () => {
    switch (size) {
      case 'large': return { height: 56, paddingHorizontal: 24, borderRadius: radius.lg };
      case 'medium': return { height: 48, paddingHorizontal: 20, borderRadius: radius.md };
      case 'small': return { height: 40, paddingHorizontal: 16, borderRadius: radius.md };
      default: return { height: 56, paddingHorizontal: 24, borderRadius: radius.lg };
    }
  };

  const getFontSize = () => {
    switch (size) {
      case 'large': return 16;
      case 'medium': return 14;
      case 'small': return 12;
      default: return 16;
    }
  };

  const baseStyles = [
    styles.button,
    getBackgroundStyle(),
    getSizeStyle(),
    (disabled || loading) && { opacity: 0.6 },
    style,
  ];

  const baseTextStyles = [
    styles.text,
    getTextStyle(),
    { fontSize: getFontSize() },
    textStyle,
  ];

  const iconColor = getTextStyle().color;

  return (
    <AnimatedPressable
      style={baseStyles}
      onPress={onPress}
      disabled={disabled || loading}
      // Loading buttons shouldn't buzz; a disabled/loading button neither
      // scales nor taps (AnimatedPressable already skips scale when disabled).
      haptic={disabled || loading ? 'none' : 'tap'}
    >
      {loading ? (
        <ActivityIndicator color={iconColor} />
      ) : (
        <View style={styles.content}>
          {iconName && iconPosition === 'left' && (
            <MaterialIcons name={iconName} size={getFontSize() * 1.2} color={iconColor} style={styles.iconLeft} />
          )}
          <Text style={baseTextStyles}>{title}</Text>
          {iconName && iconPosition === 'right' && (
            <MaterialIcons name={iconName} size={getFontSize() * 1.2} color={iconColor} style={styles.iconRight} />
          )}
        </View>
      )}
    </AnimatedPressable>
  );
};

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontFamily: font.bold,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  iconLeft: {
    marginRight: 8,
  },
  iconRight: {
    marginLeft: 8,
  },
});
