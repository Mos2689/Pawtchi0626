import React, { useEffect } from 'react';
import { View, TouchableOpacity, StyleSheet, ViewProps } from 'react-native';
import Animated, { 
  useSharedValue, 
  withRepeat, 
  withTiming, 
  withSequence,
  useAnimatedStyle 
} from 'react-native-reanimated';
import { useWalkthrough } from '../../providers/WalkthroughContext';
import { Colors } from '../../constants/Theme';

interface HotspotProps extends ViewProps {
  stepKey: string;
  title: string;
  description: string;
  children: React.ReactNode;
  position?: 'top-right' | 'top-left' | 'center' | 'bottom-right';
}

export function Hotspot({ 
  stepKey, 
  title, 
  description, 
  children, 
  position = 'top-right', 
  style, 
  ...props 
}: HotspotProps) {
  const { activeStepKey, showTooltip } = useWalkthrough();
  const isActive = activeStepKey === stepKey;
  
  const scale = useSharedValue(1);

  useEffect(() => {
    if (isActive) {
      scale.value = withRepeat(
        withSequence(
          withTiming(1.3, { duration: 150 }),
          withTiming(1, { duration: 150 }),
          withTiming(1.3, { duration: 150 }),
          withTiming(1, { duration: 1000 })
        ),
        -1,
        false
      );
    } else {
      scale.value = 1; // reset when not active
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const getPositionStyle = (): any => {
    switch (position) {
      case 'top-left': return { top: -6, left: -6 };
      case 'center': return { top: '50%', left: '50%', marginTop: -12, marginLeft: -12 };
      case 'bottom-right': return { bottom: -6, right: -6 };
      case 'top-right':
      default:
        return { top: -6, right: -6 };
    }
  };

  return (
    <View style={[styles.wrapper, style]} {...props} collapsable={false}>
      {children}
      {isActive && (
        <TouchableOpacity 
          style={[styles.hotspotContainer, getPositionStyle()]}
          onPress={() => showTooltip(title, description)}
          activeOpacity={0.8}
        >
          <Animated.View style={[styles.pulseRing, animatedStyle]} />
          <View style={styles.coreDot} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
    // Do not set overflow: hidden here so the dot can protrude
  },
  hotspotContainer: {
    position: 'absolute',
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999, // Ensure it's above children
  },
  pulseRing: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(4, 16, 21, 0.4)', // Dark blue with opacity
  },
  coreDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#041015', // Dark blue
    shadowColor: '#041015',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 6,
    elevation: 4,
  }
});
