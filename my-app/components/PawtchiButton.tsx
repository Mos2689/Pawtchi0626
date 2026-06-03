import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, ViewStyle, TextStyle, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

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
      case 'primary': return { backgroundColor: '#FFFC00' };
      case 'secondary': return { backgroundColor: '#e5eeff' };
      case 'black': return { backgroundColor: '#000407' };
      case 'outline': return { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#000407' };
      case 'ghost': return { backgroundColor: 'transparent' };
      default: return { backgroundColor: '#FFFC00' };
    }
  };

  const getTextStyle = () => {
    switch (variant) {
      case 'primary': return { color: '#000407' };
      case 'secondary': return { color: '#000407' };
      case 'black': return { color: '#FFFC00' };
      case 'outline': return { color: '#000407' };
      case 'ghost': return { color: '#42474b' };
      default: return { color: '#000407' };
    }
  };

  const getSizeStyle = () => {
    switch (size) {
      case 'large': return { paddingVertical: 16, paddingHorizontal: 24, borderRadius: 16 };
      case 'medium': return { paddingVertical: 12, paddingHorizontal: 20, borderRadius: 14 };
      case 'small': return { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 12 };
      default: return { paddingVertical: 16, paddingHorizontal: 24, borderRadius: 16 };
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
    <TouchableOpacity
      style={baseStyles}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={activeOpacity}
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
    </TouchableOpacity>
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
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    textAlign: 'center',
  },
  iconLeft: {
    marginRight: 8,
  },
  iconRight: {
    marginLeft: 8,
  },
});
