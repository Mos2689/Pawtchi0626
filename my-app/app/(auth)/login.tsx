import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, { useSharedValue, useAnimatedStyle, withSequence, withTiming } from 'react-native-reanimated';
import { supabase } from '../../lib/supabase';
import { color, font, radius, space, motion } from '../../constants/design';
import { PawtchiButton } from '../../components/PawtchiButton';
import { CountUpText } from '../../components/CountUpText';
import { track } from '../../lib/analytics';
import { clearFreshSignup, markFreshSignup } from '../../lib/onboardingFunnel';
import { errorCopy, reportError, toAppError } from '../../lib/appError';
import { haptic } from '../../lib/haptics';
import Svg, { Rect, Path, Circle, Ellipse } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';

const HERO_IMAGE = require('../../assets/images/auth-hero.png');

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { mode } = useLocalSearchParams<{ mode: string }>();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(mode === 'signup');
  const [formError, setFormError] = useState<string | null>(null);

  // Track screen view with mode
  React.useEffect(() => {
    track('auth_screen_viewed', { mode: isSignUp ? 'signup' : 'signin' });
  }, []);

  // Error shake — a short horizontal jolt on the input block.
  const shakeX = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shakeX.value }] }));
  const jolt = motion.duration.instant / 2;

  // Local guidance strings ("type your email above") show verbatim.
  const showError = (message: string) => {
    setFormError(message);
    haptic.warning();
    shakeX.value = withSequence(
      withTiming(-7, { duration: jolt }),
      withTiming(7, { duration: jolt }),
      withTiming(-4, { duration: jolt }),
      withTiming(0, { duration: jolt }),
    );
  };

  const setEmailClean = (v: string) => { if (formError) setFormError(null); setEmail(v); };
  const setPasswordClean = (v: string) => { if (formError) setFormError(null); setPassword(v); };

  async function signInWithEmail() {
    setFormError(null);
    track('auth_signin_started', {});
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email,
      password: password,
    });

    setLoading(false);
    if (error) {
      const appErr = toAppError(error);
      reportError(appErr, 'auth');
      track('auth_signin_failed', { reason: appErr.detailKey ?? appErr.kind });
      showError(errorCopy(appErr, { context: 'auth' }).message);
    } else {
      track('auth_signin_succeeded', {});
      router.replace('/(tabs)');
    }
  }

  function handleForgotPassword() {
    const emailTrimmed = email.trim();
    if (!emailTrimmed) {
      showError('Type your email above, then tap Forgot password.');
      return;
    }
    track('auth_forgot_password', {});
    // The reset flow lives on its own screen: it sends a 6-digit code and lets
    // the user set a new password in-app — no email link, no browser hop.
    router.push({ pathname: '/(auth)/reset-password', params: { email: emailTrimmed } } as any);
  }

  async function signUpWithEmail() {
    setFormError(null);
    track('auth_signup_started', {});
    setLoading(true);
    // Marked BEFORE the call: the session event (and the auth gate's
    // navigation) can fire before this await resumes. With the latch set,
    // the gate routes a fresh account straight to onboarding — no tabs boot
    // loader between "Create account" and the species screen.
    markFreshSignup();
    const { data, error } = await supabase.auth.signUp({
      email: email,
      password: password,
      options: {
        data: {
          full_name: email.split('@')[0],
        }
      }
    });

    setLoading(false);
    if (error) {
      clearFreshSignup();
      const appErr = toAppError(error);
      reportError(appErr, 'auth');
      track('auth_signup_failed', { reason: appErr.detailKey ?? appErr.kind });
      showError(errorCopy(appErr, { context: 'auth' }).message);
    } else if (data.session === null) {
      // Email confirmation required — no session yet, so clear the latch (the
      // confirm screen re-marks it right before verifyOtp) and hand off to the
      // in-app code entry. The confirmation email is already on its way.
      clearFreshSignup();
      router.push({ pathname: '/(auth)/confirm-email', params: { email: email.trim() } } as any);
    } else {
      track('auth_signup_succeeded', {});
      // Acknowledge the commitment — the centralized auth gate handles the
      // cut to onboarding the moment the session lands.
      haptic.success();
    }
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1 }}
          bounces={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── HERO IMAGE ── */}
          <View style={styles.hero}>
            <Image source={HERO_IMAGE} style={styles.heroImage} />

            {/* Top darkening gradient for status bar legibility */}
            <LinearGradient
              colors={['rgba(7,32,42,0.35)', 'rgba(7,32,42,0)']}
              style={styles.heroTopGradient}
            />
            {/* Bottom fade into white */}
            <LinearGradient
              colors={['rgba(255,255,255,0)', color.surface]}
              locations={[0, 0.92]}
              style={styles.heroBottomGradient}
            />

            {/* PAWTCHI wordmark — same display treatment as the welcome screen */}
            <View style={[styles.wordmarkWrap, { top: insets.top + 20 }]}>
              <Text style={styles.wordmark}>PAWTCHI</Text>
            </View>

            {/* Decorative stat stack — counts up on mount so the product
                preview reads as alive, not printed */}
            <View style={styles.statStack}>
              {/* Kcal */}
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>Kcal</Text>
                <View style={styles.statRow}>
                  <Svg width={22} height={24} viewBox="0 0 24 26" fill="none">
                    <Path d="M12 1.5c.6 3.4-1.6 4.7-3.3 7-1.4 1.9-2.5 4-2.5 6.6 0 4.4 3.5 8 7.8 8s7.8-3.6 7.8-8c0-3.8-2-7-4.5-9-.7 1.4-1.8 2-2.7 1.6 0-2.5-1.2-4.8-2.6-6.2z" stroke="#ffffff" strokeWidth={1.5} strokeLinejoin="round" />
                    <Path d="M9.5 17.5c0-1.8 1-3.2 2.5-4 1.6.8 2.5 2.2 2.5 4 0 1.4-1.1 2.5-2.5 2.5s-2.5-1.1-2.5-2.5z" fill={color.yellow} stroke="#ffffff" strokeWidth={1.2} />
                  </Svg>
                  <CountUpText value={487} style={styles.statValue} duration={motion.duration.ring} />
                  <Text style={styles.statUnit}>today</Text>
                </View>
              </View>

              {/* Hydration */}
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>Hydration</Text>
                <View style={styles.statRow}>
                  <Svg width={22} height={24} viewBox="0 0 24 26" fill="none">
                    <Path d="M12 2.5c0 0-7.5 8-7.5 13.2A7.5 7.5 0 0012 23a7.5 7.5 0 007.5-7.3C19.5 10.5 12 2.5 12 2.5z" stroke="#ffffff" strokeWidth={1.5} strokeLinejoin="round" />
                    <Path d="M8 15.5a4 4 0 003.5 3.7" stroke="#ffffff" strokeWidth={1.3} strokeLinecap="round" opacity={0.85} />
                    <Circle cx={12} cy={16} r={2.4} fill={color.yellow} />
                  </Svg>
                  <CountUpText
                    value={320}
                    style={styles.statValue}
                    duration={motion.duration.ring}
                    delay={motion.duration.instant}
                  />
                  <Text style={styles.statUnit}>ml</Text>
                </View>
              </View>

              {/* Walk */}
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>Walk</Text>
                <View style={styles.statRow}>
                  <Svg width={22} height={24} viewBox="0 0 26 28" fill="none">
                    <Path d="M13 15.5c-3.2 0-6 2.4-6 5.2 0 1.7 1.4 3.1 3.2 3.1.9 0 1.8-.4 2.8-.4s1.9.4 2.8.4c1.8 0 3.2-1.4 3.2-3.1 0-2.8-2.8-5.2-6-5.2z" fill={color.yellow} stroke="#ffffff" strokeWidth={1.4} strokeLinejoin="round" />
                    <Ellipse cx={6.5} cy={12} rx={1.8} ry={2.4} fill="#ffffff" rotation={-20} origin="6.5, 12" />
                    <Ellipse cx={10.5} cy={8} rx={1.7} ry={2.3} fill="#ffffff" rotation={-8} origin="10.5, 8" />
                    <Ellipse cx={15.5} cy={8} rx={1.7} ry={2.3} fill="#ffffff" rotation={8} origin="15.5, 8" />
                    <Ellipse cx={19.5} cy={12} rx={1.8} ry={2.4} fill="#ffffff" rotation={20} origin="19.5, 12" />
                  </Svg>
                  <CountUpText
                    value={3.2}
                    decimals={1}
                    style={styles.statValue}
                    duration={motion.duration.ring}
                    delay={motion.duration.instant * 2}
                  />
                  <Text style={styles.statUnit}>km</Text>
                </View>
              </View>
            </View>
          </View>

          {/* ── CONTENT ── */}
          <View style={styles.content}>
            {/* Headline */}
            <Text style={styles.headline}>
              {isSignUp ? 'START ' : 'WELCOME '}
              <Text style={styles.headlineHighlight}>
                {isSignUp ? 'NOTICING.' : 'BACK.'}
              </Text>
            </Text>

            {/* Subhead */}
            <Text style={styles.subhead}>
              {isSignUp
                ? 'Create an account and build the full picture of their health.'
                : 'Sign in to pick up where you left off.'}
            </Text>

            <Animated.View style={shakeStyle}>
              {/* Email input */}
              <View style={[styles.inputContainer, formError && styles.inputContainerError]}>
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                  <Rect x={3} y={5} width={18} height={14} rx={2} stroke={color.navy} strokeWidth={1.8} />
                  <Path d="M3 7l9 6 9-6" stroke={color.navy} strokeWidth={1.8} strokeLinejoin="round" />
                </Svg>
                <TextInput
                  style={styles.input}
                  placeholder="Email address"
                  placeholderTextColor={color.slateFaint}
                  value={email}
                  onChangeText={setEmailClean}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
              </View>

              {/* Password input */}
              <View style={[styles.inputContainer, formError && styles.inputContainerError]}>
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                  <Rect x={4} y={11} width={16} height={10} rx={2} stroke={color.navy} strokeWidth={1.8} />
                  <Path d="M8 11V8a4 4 0 018 0v3" stroke={color.navy} strokeWidth={1.8} />
                </Svg>
                <TextInput
                  style={styles.input}
                  placeholder="Password"
                  placeholderTextColor={color.slateFaint}
                  value={password}
                  onChangeText={setPasswordClean}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  onPress={() => setShowPassword((v) => !v)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <MaterialIcons
                    name={showPassword ? 'visibility-off' : 'visibility'}
                    size={20}
                    color={color.slateFaint}
                  />
                </TouchableOpacity>
              </View>
            </Animated.View>

            {formError && (
              <View style={styles.errorRow}>
                <MaterialIcons name="error-outline" size={15} color={color.error} />
                <Text style={styles.errorText}>{formError}</Text>
              </View>
            )}

            {/* CTA */}
            <PawtchiButton
              title={isSignUp ? 'Create account' : 'Sign in'}
              variant="primary"
              iconName="arrow-forward"
              iconPosition="right"
              loading={loading}
              onPress={isSignUp ? signUpWithEmail : signInWithEmail}
              style={styles.cta}
            />

            {/* ── Collection notice (APP 5 / IPP 3) ──
                Must appear BEFORE an account exists. Until this shipped, the
                policy was only reachable from Profile and the paywall — i.e.
                after signup and the whole onboarding health questionnaire —
                so there was no notice at the point of collection, and the
                policy's "by using the App you consent" had nothing behind it. */}
            {isSignUp && (
              <Text style={styles.consentNotice}>
                We collect your email and the pet details you enter to work out feeding,
                hydration and activity targets. Read our{' '}
                <Text
                  style={styles.consentLink}
                  onPress={() => router.push('/privacy' as any)}
                >
                  Privacy Policy
                </Text>
                {' '}and{' '}
                <Text
                  style={styles.consentLink}
                  onPress={() => Linking.openURL('https://pawtchi.com/terms')}
                >
                  Terms of Service
                </Text>
                .
              </Text>
            )}

            {/* Toggle */}
            <View style={styles.toggleContainer}>
              <Text style={styles.toggleText}>
                {isSignUp ? 'Already have an account?' : 'New to Pawtchi?'}
              </Text>
              <TouchableOpacity onPress={() => { 
                const newMode = !isSignUp;
                setIsSignUp(newMode); 
                setFormError(null); 
                track('auth_mode_switched', { to_mode: newMode ? 'signup' : 'signin' });
              }} disabled={loading}>
                <Text style={styles.toggleBtnText}>
                  {isSignUp ? 'Sign in' : 'Create account'}
                </Text>
              </TouchableOpacity>
            </View>

            {!isSignUp && (
              <TouchableOpacity
                onPress={handleForgotPassword}
                disabled={loading}
                style={styles.forgotBtn}
              >
                <Text style={styles.forgotText}>Forgot password?</Text>
              </TouchableOpacity>
            )}

            {/* Footer */}
            <Text style={styles.footer}>Notice everything</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.surface,
  },

  // ── Hero ──
  hero: {
    position: 'relative',
    height: 380,
    overflow: 'hidden',
    marginBottom: 22,
  },
  heroImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  heroTopGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 130,
    zIndex: 1,
  },
  heroBottomGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 110,
    zIndex: 1,
  },
  wordmarkWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  wordmark: {
    fontFamily: font.display,
    fontSize: 28,
    letterSpacing: 4,
    color: '#ffffff',
    textShadowColor: 'rgba(7,32,42,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },

  // ── Decorative stats ──
  statStack: {
    position: 'absolute',
    top: 125,
    right: 16,
    zIndex: 3,
    gap: 18,
  },
  statItem: {
    alignItems: 'flex-start',
  },
  statLabel: {
    fontFamily: font.bold,
    fontSize: 10,
    color: '#ffffff',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    lineHeight: 10,
    opacity: 0.95,
    marginBottom: 6,
    textShadowColor: 'rgba(7,32,42,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statValue: {
    fontFamily: font.display,
    fontSize: 34,
    letterSpacing: 0.5,
    color: '#ffffff',
    lineHeight: 40,
    textShadowColor: 'rgba(7,32,42,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },
  statUnit: {
    fontFamily: font.bold,
    fontSize: 10,
    color: '#ffffff',
    opacity: 0.85,
    marginTop: 2,
    textShadowColor: 'rgba(7,32,42,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },

  // ── Content ──
  content: {
    flex: 1,
    paddingHorizontal: 28,
    paddingBottom: 24,
  },
  headline: {
    fontFamily: font.display,
    fontSize: 60,
    lineHeight: 64,
    color: color.navy,
    letterSpacing: 1,
    marginBottom: 12,
  },
  headlineHighlight: {
    fontFamily: font.display,
    fontSize: 60,
    color: color.navy,
    letterSpacing: 1,
  },
  subhead: {
    fontFamily: font.medium,
    fontSize: 13,
    lineHeight: 20,
    color: color.slateMuted,
    marginBottom: 20,
    maxWidth: 320,
  },

  // ── Inputs ──
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: color.surface,
    borderWidth: 1.5,
    borderColor: color.hairline,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 52,
    marginBottom: 10,
  },
  inputContainerError: {
    borderColor: color.error,
  },
  input: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 14,
    color: color.navy,
    height: '100%',
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  errorText: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 13,
    color: color.error,
    lineHeight: 18,
  },

  // ── CTA ──
  cta: {
    marginTop: 4,
    borderRadius: 14,
  },

  // ── Toggle ──
  toggleContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space.sm,
    marginTop: 14,
  },
  toggleText: {
    fontFamily: font.medium,
    fontSize: 13,
    color: color.slateMuted,
  },
  toggleBtnText: {
    fontFamily: font.extrabold,
    fontSize: 13,
    color: color.navy,
    borderBottomWidth: 2,
    borderBottomColor: color.yellow,
    paddingBottom: 1,
  },

  // ── Collection notice ──
  consentNotice: {
    marginTop: 14,
    textAlign: 'center',
    fontFamily: font.medium,
    fontSize: 11.5,
    lineHeight: 17,
    color: color.slateMuted,
  },
  consentLink: {
    fontFamily: font.extrabold,
    color: color.navy,
    textDecorationLine: 'underline',
  },

  // ── Forgot password ──
  forgotBtn: {
    alignItems: 'center',
    marginTop: space.sm,
    paddingVertical: space.sm,
  },
  forgotText: {
    fontFamily: font.medium,
    fontSize: 13,
    color: color.slateMuted,
    textDecorationLine: 'underline',
  },

  // ── Footer ──
  footer: {
    marginTop: 14,
    textAlign: 'center',
    fontFamily: font.semibold,
    fontSize: 11,
    color: color.slateFaint,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});
