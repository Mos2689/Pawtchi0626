import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface CircularProgressProps {
  size: number;
  strokeWidth: number;
  progress: number; // 0 to 1
  color: string;
  trackColor?: string;
  children?: React.ReactNode;
}

export default function CircularProgress({
  size,
  strokeWidth,
  progress,
  color,
  trackColor = '#e5e7eb',
  children,
}: CircularProgressProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  // Guard against NaN or negative
  const safeProgress = Number.isNaN(progress) ? 0 : Math.min(Math.max(progress, 0), 1);
  const targetOffset = circumference - safeProgress * circumference;

  const animatedValue = useRef(new Animated.Value(circumference)).current;

  useEffect(() => {
    Animated.timing(animatedValue, {
      toValue: targetOffset,
      duration: 1200, // Smooth 1.2s fill
      useNativeDriver: true,
    }).start();
  }, [targetOffset, animatedValue]);

  return (
    <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
      <Svg width={size} height={size}>
        <G rotation="-90" origin={`${size / 2}, ${size / 2}`}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={trackColor}
            strokeWidth={strokeWidth}
            fill="transparent"
          />
          <AnimatedCircle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={color}
            strokeWidth={strokeWidth}
            fill="transparent"
            strokeDasharray={circumference}
            strokeDashoffset={animatedValue}
            strokeLinecap="round"
          />
        </G>
      </Svg>
      <View style={[StyleSheet.absoluteFillObject, { justifyContent: 'center', alignItems: 'center' }]}>
        {children}
      </View>
    </View>
  );
}
