import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Typography } from './Typography';
import { Colors } from '../constants/Theme';
// In a real app we'd use unplugin/icons or expo/vector-icons. Assuming expo-vector-icons is available.
import MaterialIcons from '@expo/vector-icons/MaterialIcons'; 

interface HeaderProps {
  title?: string;
  showBack?: boolean;
  onBack?: () => void;
  rightElement?: React.ReactNode;
}

export const Header: React.FC<HeaderProps> = ({ 
  title, 
  showBack = true, 
  onBack,
  rightElement 
}) => {
  const router = useRouter();
  const themeColors = Colors.light;

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      if (router.canGoBack()) {
        router.back();
      }
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.left}>
        {showBack && (
          <TouchableOpacity onPress={handleBack} style={styles.iconButton}>
            <MaterialIcons name="arrow-back" size={24} color={themeColors['on-surface']} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.center}>
        {title && (
          <Typography variant="headline" weight="bold" size={20} color="on-surface" align="center">
            {title}
          </Typography>
        )}
      </View>

      <View style={styles.right}>
        {rightElement}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.8)', // rough backdrop blur fallback
    zIndex: 50,
  },
  left: {
    flex: 1,
    alignItems: 'flex-start',
  },
  center: {
    flex: 2,
    alignItems: 'center',
  },
  right: {
    flex: 1,
    alignItems: 'flex-end',
  },
  iconButton: {
    padding: 8,
    margin: -8, // expand hit area
  }
});

export default Header;
