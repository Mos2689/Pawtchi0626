import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStreakStore } from '../store/useStreakStore';

const MILESTONE_MESSAGES: Record<number, string> = {
  3: '3-day streak',
  7: '7-day streak',
  14: '2-week streak',
  30: '30-day streak',
};

export function CoinToast() {
  const insets = useSafeAreaInsets();
  const { lastEarnEvent, clearLastEarn } = useStreakStore();
  const slideAnim = useRef(new Animated.Value(-160)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const coinBounce = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!lastEarnEvent) return;

    // Reset
    slideAnim.setValue(-160);
    opacityAnim.setValue(0);
    scaleAnim.setValue(0.8);
    coinBounce.setValue(1);

    // Slide in with spring
    Animated.parallel([
      Animated.spring(slideAnim, {
        toValue: insets.top + 12,
        tension: 80,
        friction: 12,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 100,
        friction: 8,
        useNativeDriver: true,
      }),
    ]).start();

    // Coin icon bounce
    Animated.sequence([
      Animated.delay(300),
      Animated.spring(coinBounce, {
        toValue: 1.3,
        tension: 200,
        friction: 5,
        useNativeDriver: true,
      }),
      Animated.spring(coinBounce, {
        toValue: 1,
        tension: 200,
        friction: 10,
        useNativeDriver: true,
      }),
    ]).start();

    // Auto-dismiss after 3.5 seconds
    const timeout = setTimeout(() => {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: -160,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(() => {
        clearLastEarn();
      });
    }, 3500);

    return () => clearTimeout(timeout);
  }, [lastEarnEvent]);

  if (!lastEarnEvent) return null;

  const isMilestone = !!lastEarnEvent.milestone;
  const milestoneMsg = lastEarnEvent.milestone 
    ? MILESTONE_MESSAGES[lastEarnEvent.milestone] || `${lastEarnEvent.milestone}-day streak`
    : null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          transform: [
            { translateY: slideAnim },
            { scale: scaleAnim },
          ],
          opacity: opacityAnim,
        },
      ]}
      pointerEvents="none"
    >
      <View style={[styles.toast, isMilestone && styles.toastMilestone]}>
        {/* Left: Coin icon */}
        <Animated.View style={{ transform: [{ scale: coinBounce }] }}>
          <View style={[styles.coinCircle, isMilestone && styles.coinCircleMilestone]}>
            <MaterialIcons 
              name={isMilestone ? 'local-fire-department' : 'generating-tokens'} 
              size={24} 
              color={isMilestone ? '#FFFFFF' : '#3d2b00'} 
            />
          </View>
        </Animated.View>

        {/* Center: Text */}
        <View style={styles.textContainer}>
          <Text style={[styles.coinsText, isMilestone && styles.coinsTextMilestone]}>
            +{lastEarnEvent.coins} PawCoins
          </Text>
          <Text style={[styles.reasonText, isMilestone && styles.reasonTextMilestone]}>
            {isMilestone ? milestoneMsg : lastEarnEvent.label}
          </Text>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 20,
    minWidth: 240,
  },
  toastMilestone: {
    backgroundColor: '#0f172a',
    borderColor: '#fac129',
    borderWidth: 2,
  },
  coinCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F7F602',
    justifyContent: 'center',
    alignItems: 'center',
  },
  coinCircleMilestone: {
    backgroundColor: '#fac129',
  },
  textContainer: {
    flex: 1,
  },
  coinsText: {
    fontFamily: 'Montserrat_800ExtraBold',
    fontSize: 18,
    color: '#07202A',
    letterSpacing: -0.3,
  },
  coinsTextMilestone: {
    color: '#F7F602',
  },
  reasonText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 13,
    color: '#64748b',
    marginTop: 2,
  },
  reasonTextMilestone: {
    color: '#fac129',
  },
  milestoneGlow: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  milestoneEmoji: {
    fontSize: 24,
  },
});
