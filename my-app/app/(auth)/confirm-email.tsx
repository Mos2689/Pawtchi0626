import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, { useSharedValue, useAnimatedStyle, withSequence, withTiming } from 'react-native-reanimated';
import { supabase } from '../../lib/supabase';
import { color, font, space, motion } from '../../constants/design';
import { PawtchiButton } from '../../components/PawtchiButton';
import { track } from '../../lib/analytics';
import { errorCopy, reportError, toAppError } from '../../lib/appError';
import { haptic } from '../../lib/haptics';
import { markFreshSignup, clearFreshSignup } from '../../lib/onboardingFunnel';

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_S = 30;

// Post-signup email confirmation — the code half of the OTP signup flow.
// signUpWithEmail already sent the confirmation email (the Supabase "Confirm
// signup" template must emit {{ .Token }}); this screen verifies the code with
// type 'signup', which creates the session. Navigation is then the auth gate's
// job: freshSignup is re-marked right before verifyOtp so the gate routes the
// brand-new account straight to /onboarding/species, exactly like a
// confirmation-free signup.
export default function ConfirmEmailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { email: emailParam } = useLocalSearchParams<{ email?: string }>();
  const email = (emailParam ?? '').trim();

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Sign-up just sent the first email — start the resend window closed.
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // Error shake — same short horizontal jolt as the login screen.
  const shakeX = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shakeX.value }] }));
  const jolt = motion.duration.instant / 2;
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

  async function resendCode() {
    if (cooldown > 0 || loading) return;
    setFormError(null);
    setLoading(true);
    const { error } = await supabase.auth.resend({ type: 'signup', email });
    setLoading(false);
    if (error) {
      const appErr = toAppError(error);
      reportError(appErr, 'auth');
      showError(errorCopy(appErr, { context: 'auth' }).message);
      return;
    }
    track('auth_signup_code_resent', {});
    setCooldown(RESEND_COOLDOWN_S);
  }

  async function confirmCode() {
    if (code.trim().length !== CODE_LENGTH) {
      showError(`Enter the ${CODE_LENGTH}-digit code from your email.`);
      return;
    }
    setFormError(null);
    setLoading(true);
    // Re-mark BEFORE verifyOtp: the session event (and the auth gate's
    // navigation) can fire before this await resumes. With the latch set, the
    // gate routes the confirmed account straight to onboarding — same reasoning
    // as markFreshSignup() before supabase.auth.signUp in login.tsx.
    markFreshSignup();
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: 'signup',
    });
    if (error) {
      clearFreshSignup();
      setLoading(false);
      const appErr = toAppError(error);
      reportError(appErr, 'auth');
      track('auth_signup_failed', { reason: appErr.detailKey ?? appErr.kind, step: 'confirm' });
      showError('That code didn’t match, or it expired. Check it and try again, or resend a new one.');
      return;
    }
    haptic.success();
    track('auth_signup_succeeded', { via: 'email_confirmation' });
    // No navigation here — the centralized auth gate reacts to the new session
    // and consumes the freshSignup latch to cut straight to onboarding.
  }

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
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
          {/* Back */}
          <TouchableOpacity
            onPress={() => router.back()}
            style={[styles.backBtn, { top: insets.top + 8 }]}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <MaterialIcons name="arrow-back" size={24} color={color.navy} />
          </TouchableOpacity>

          <View style={[styles.content, { paddingTop: insets.top + 64 }]}>
            <Text style={styles.headline}>
              CONFIRM <Text style={styles.headlineHighlight}>YOUR EMAIL.</Text>
            </Text>
            <Text style={styles.subhead}>
              {`We sent a ${CODE_LENGTH}-digit code to ${email}. Enter it below to finish creating your account.`}
            </Text>

            <Animated.View style={shakeStyle}>
              <View style={[styles.inputContainer, formError && styles.inputContainerError]}>
                <MaterialIcons name="pin" size={18} color={color.navy} />
                <TextInput
                  style={[styles.input, styles.codeInput]}
                  placeholder="6-digit code"
                  placeholderTextColor={color.slateFaint}
                  value={code}
                  onChangeText={(v) => {
                    if (formError) setFormError(null);
                    setCode(v.replace(/[^0-9]/g, '').slice(0, CODE_LENGTH));
                  }}
                  keyboardType="number-pad"
                  maxLength={CODE_LENGTH}
                />
              </View>
            </Animated.View>

            {formError && (
              <View style={styles.errorRow}>
                <MaterialIcons name="error-outline" size={15} color={color.error} />
                <Text style={styles.errorText}>{formError}</Text>
              </View>
            )}

            <PawtchiButton
              title="Confirm email"
              variant="primary"
              iconName="arrow-forward"
              iconPosition="right"
              loading={loading}
              onPress={confirmCode}
              style={styles.cta}
            />

            <TouchableOpacity
              onPress={resendCode}
              disabled={cooldown > 0 || loading}
              style={styles.resendBtn}
            >
              <Text style={[styles.resendText, cooldown > 0 && styles.resendTextDisabled]}>
                {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
              </Text>
            </TouchableOpacity>
            <Text style={styles.spamHint}>
              Not seeing the email? Give it a minute — and check your spam folder.
            </Text>
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
  backBtn: {
    position: 'absolute',
    left: 20,
    zIndex: 5,
  },
  content: {
    flex: 1,
    paddingHorizontal: 28,
    paddingBottom: 24,
  },
  headline: {
    fontFamily: font.display,
    fontSize: 52,
    lineHeight: 56,
    color: color.navy,
    letterSpacing: 1,
    marginBottom: 12,
  },
  headlineHighlight: {
    fontFamily: font.display,
    fontSize: 52,
    color: color.navy,
    letterSpacing: 1,
  },
  subhead: {
    fontFamily: font.medium,
    fontSize: 13,
    lineHeight: 20,
    color: color.slateMuted,
    marginBottom: 24,
    maxWidth: 320,
  },
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
  codeInput: {
    letterSpacing: 6,
    fontFamily: font.bold,
    fontSize: 18,
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
  cta: {
    marginTop: 4,
    borderRadius: 14,
  },
  resendBtn: {
    alignItems: 'center',
    marginTop: space.sm,
    paddingVertical: space.sm,
  },
  resendText: {
    fontFamily: font.semibold,
    fontSize: 13,
    color: color.navy,
    textDecorationLine: 'underline',
  },
  resendTextDisabled: {
    color: color.slateFaint,
    textDecorationLine: 'none',
  },
  spamHint: {
    marginTop: 2,
    textAlign: 'center',
    fontFamily: font.medium,
    fontSize: 12,
    lineHeight: 17,
    color: color.slateFaint,
  },
});
