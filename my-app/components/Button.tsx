import React from 'react';
import { TouchableOpacity, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors } from '../constants/Theme';
import { Typography } from './Typography';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost';

interface ButtonProps {
  title: string;
  onPress?: () => void;
  href?: string;
  variant?: ButtonVariant;
  style?: ViewStyle | ViewStyle[];
  textStyle?: TextStyle | TextStyle[];
  icon?: React.ReactNode;
  fullWidth?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  title,
  onPress,
  href,
  variant = 'primary',
  style,
  textStyle,
  icon,
  fullWidth = true,
}) => {
  const router = useRouter();
  const themeColors = Colors.light; // simplified for now

  const handlePress = () => {
    if (onPress) {
      onPress();
    } else if (href) {
      router.push(href as any);
    }
  };

  const getVariantStyles = () => {
    switch (variant) {
      case 'primary':
        return {
          container: {
            backgroundColor: themeColors.primary,
            shadowColor: themeColors.primary,
            shadowOffset: { width: 0, height: 12 },
            shadowOpacity: 0.5,
            shadowRadius: 24,
            elevation: 8,
          },
          text: { color: themeColors['on-primary'] },
        };
      case 'secondary':
        return {
          container: { backgroundColor: themeColors['secondary-container'] },
          text: { color: themeColors['on-secondary-container'] },
        };
      case 'outline':
        return {
          container: { 
            backgroundColor: 'transparent', 
            borderWidth: 1, 
            borderColor: themeColors['outline-variant'] 
          },
          text: { color: themeColors['on-surface'] },
        };
      case 'ghost':
        return {
          container: { backgroundColor: 'transparent' },
          text: { color: themeColors.primary },
        };
      default:
        return { container: {}, text: {} };
    }
  };

  const styles = getVariantStyles();

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={handlePress}
      style={[
        baseStyles.button,
        styles.container,
        fullWidth && baseStyles.fullWidth,
        style,
      ]}
    >
      {icon}
      <Typography
        variant="label"
        weight="extrabold"
        size={18}
        style={[styles.text, textStyle]}
      >
        {title}
      </Typography>
    </TouchableOpacity>
  );
};

const baseStyles = StyleSheet.create({
  button: {
    paddingVertical: 18,
    paddingHorizontal: 24,
    borderRadius: 9999, // full rounding like Stitch
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  fullWidth: {
    width: '100%',
  },
});

export default Button;
