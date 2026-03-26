import React from 'react';
import { View, StyleSheet, ViewStyle, TouchableOpacity } from 'react-native';
import { Colors } from '../constants/Theme';

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  selected?: boolean;
  onPress?: () => void;
  variant?: 'outline' | 'filled' | 'elevated';
}

export const Card: React.FC<CardProps> = ({
  children,
  style,
  selected = false,
  onPress,
  variant = 'outline',
}) => {
  const themeColors = Colors.light;

  const getVariantStyles = () => {
    switch (variant) {
      case 'filled':
        return {
          backgroundColor: themeColors['surface-container-low'],
          borderColor: 'transparent',
        };
      case 'elevated':
        return {
          backgroundColor: themeColors.surface,
          borderColor: 'transparent',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.1,
          shadowRadius: 12,
          elevation: 4,
        };
      case 'outline':
      default:
        return {
          backgroundColor: themeColors.surface,
          borderColor: themeColors['surface-container-highest'],
        };
    }
  };

  const content = (
    <View
      style={[
        styles.card,
        getVariantStyles(),
        selected && { 
            borderColor: themeColors.primary, 
            borderWidth: 2,
            shadowColor: themeColors.primary,
            shadowOffset: { width: 0, height: 10 },
            shadowOpacity: 0.4,
            shadowRadius: 30,
            elevation: 8,
        },
        style,
      ]}
    >
      {selected && (
        <View style={[styles.glow, { backgroundColor: themeColors.primary }]} />
      )}
      <View style={styles.inner}>
        {children}
      </View>
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity activeOpacity={0.7} onPress={onPress} style={{ width: '100%' }}>
        {content}
      </TouchableOpacity>
    );
  }

  return content;
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 32, // '2xl' rounded corners in tailwind from Stitch
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  glow: {
    position: 'absolute',
    top: -20,
    left: -20,
    right: -20,
    bottom: -20,
    opacity: 0.2,
    // Note: react-native doesn't support 'blur' natively like CSS.
    // For a true glow effect in RN, you often need an Image background or Expo-blur
  },
  inner: {
    padding: 32,
    position: 'relative',
    zIndex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  }
});

export default Card;
