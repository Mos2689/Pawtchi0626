import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors } from '../constants/Theme';

// Screen 3: Welcome
export default function WelcomeScreen() {
  const router = useRouter();
  const theme = Colors.light;
  const insets = useSafeAreaInsets();
  
  // Floating animation for the badge
  const bounceAnim = useRef(new Animated.Value(0)).current;
  
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(bounceAnim, { toValue: -8, duration: 1000, useNativeDriver: true }),
        Animated.timing(bounceAnim, { toValue: 0, duration: 1000, useNativeDriver: true })
      ])
    ).start();
  }, [bounceAnim]);

  return (
    <View style={[styles.container, { backgroundColor: '#FFFFFF' }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 24 }]}>
        <Text style={[styles.logoText, { color: theme['on-surface'] }]}>PAWTCHI</Text>
        <View style={[styles.stepBadge, { backgroundColor: theme['surface-container-low'], borderColor: 'rgba(209,209,209,0.3)' }]}>
          <Text style={[styles.stepText, { color: theme['on-surface-variant'] }]}>Step 1 of 4</Text>
        </View>
      </View>

      <View style={styles.main}>
        {/* Hero Image Section */}
        <View style={styles.heroContainer}>
            {/* Fake Blobs for background contrast effect */}
            <View style={[styles.blob1, { backgroundColor: theme['primary-container'] }]} />
            <View style={[styles.blob2, { backgroundColor: theme['secondary-container'] }]} />
            
            <View style={[styles.imageWrapper, { backgroundColor: theme['surface-container-lowest'], borderColor: 'rgba(209,209,209,0.2)' }]}>
              <Image 
                source={{ uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAkN5Rum1UhJY0GrQ-SI0XGTQFMypSMmRwvyQx9EowCEBo5w2TBHhq-gOflvJALEVst9HHN4AsmJheNLADTxpOVXJt359Y1xwbu6Wd7o86waH1kyzMoobybdFVb6esMPEgPLeh1L_GSXXTna9bcwrE9eOijmpfHHIwjMsUiWRkUgX55zgqmzYIjEC7RCDhvKP2dp2t12bsWR5hqRiOjBk9uhVrD99K7XIhVEYZHn7Rk5QvrdG8jRsKoKkRku9HxZL1g_T5wxv6UPi0' }} 
                style={styles.image}
              />
              
              <Animated.View style={[styles.floatingBadge, { backgroundColor: theme['tertiary-container'], borderColor: 'rgba(96,93,52,0.1)', transform: [{ translateY: bounceAnim }] }]}>
                <MaterialIcons name="favorite" size={20} color={theme['tertiary']} />
                <Text style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 'bold', fontSize: 14, color: theme['on-tertiary-container'], marginLeft: 8 }}>+50 XP</Text>
              </Animated.View>
            </View>
        </View>

        {/* Typography */}
        <View style={styles.textContent}>
          <Text style={[styles.title, { color: theme['on-surface'] }]}>Welcome to PAWTCHI!</Text>
          <Text style={[styles.body, { color: theme['on-surface-variant'] }]}>
            Let&apos;s make pet health a game. Join thousands of happy pets on their journey to wellness.
          </Text>
        </View>

        {/* Call to Action */}
        <View style={styles.ctaContainer}>
          <TouchableOpacity 
            style={[styles.primaryBtn, { backgroundColor: '#FFFC00' }]} 
            activeOpacity={0.8}
            onPress={() => router.push({ pathname: '/(auth)/login', params: { mode: 'signup' } } as any)}
          >
            <Text style={[styles.primaryBtnText, { color: '#1C1C00' }]}>Get Started</Text>
            <MaterialIcons name="arrow-forward" size={24} color="#1C1C00" />
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.secondaryBtn} 
            activeOpacity={0.6}
            onPress={() => router.push({ pathname: '/(auth)/login', params: { mode: 'signin' } } as any)}
          >
            <Text style={[styles.secondaryBtnText, { color: theme['on-surface'] }]}>I already have an account</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Footer Indicators */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.indicatorContainer}>
          <View style={[styles.indicatorActive, { backgroundColor: '#FFFC00' }]} />
          <View style={[styles.indicatorInactive, { backgroundColor: theme['surface-container-highest'] }]} />
          <View style={[styles.indicatorInactive, { backgroundColor: theme['surface-container-highest'] }]} />
          <View style={[styles.indicatorInactive, { backgroundColor: theme['surface-container-highest'] }]} />
        </View>
        <Text style={[styles.footerText, { color: 'rgba(81,93,100,0.6)' }]}>THE RADIANT COMPANION EXPERIENCE</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    width: '100%',
    zIndex: 50,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 24,
    backgroundColor: 'transparent',
  },
  logoText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 28,
    letterSpacing: -0.5,
  },
  stepBadge: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  stepText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: 'bold',
    fontSize: 14,
  },
  main: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 8,
    alignItems: 'center',
    justifyContent: 'space-between', // Push content evenly
  },
  heroContainer: {
    width: '100%',
    flex: 1,
    maxHeight: 320, // Prevent the image from consuming the entire screen
    marginBottom: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  blob1: {
    position: 'absolute',
    width: '110%',
    height: '110%',
    borderRadius: 999,
    opacity: 0.1,
  },
  blob2: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 96,
    height: 96,
    borderRadius: 48,
    opacity: 0.15,
  },
  imageWrapper: {
    height: '100%',
    aspectRatio: 1, // Keep it square, but size it based on the flexible height instead of full width
    borderRadius: 24,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 32 },
    shadowOpacity: 0.06,
    shadowRadius: 64,
    elevation: 10,
  },
  image: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  floatingBadge: {
    position: 'absolute',
    top: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 30,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  textContent: {
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 32, // Slightly reduced to fit small screens safely
    lineHeight: 36,
    letterSpacing: -1,
    textAlign: 'center',
    marginBottom: 16,
  },
  body: {
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  ctaContainer: {
    width: '100%',
    gap: 12, // Reduced from 16
    marginBottom: 16,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 60, // Fixed height, removed contradicting paddingVertical
    borderRadius: 40,
    shadowColor: '#FFFC00',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 8,
    gap: 12,
  },
  primaryBtnText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: 'bold',
    fontSize: 18,
  },
  secondaryBtn: {
    height: 48,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: 'bold',
    fontSize: 16,
  },
  footer: {
    width: '100%',
    alignItems: 'center',
    gap: 24,
  },
  indicatorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  indicatorActive: {
    height: 8,
    width: 48,
    borderRadius: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  indicatorInactive: {
    height: 8,
    width: 8,
    borderRadius: 4,
  },
  footerText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '600',
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  }
});
