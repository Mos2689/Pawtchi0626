import React, { useEffect, useRef, useState } from 'react';
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
import Svg, { Rect, Path } from 'react-native-svg';
import { supabase } from '../../lib/supabase';
import { color, font, space, motion } from '../../constants/design';
import { PawtchiButton } from '../../components/PawtchiButton';
import { track } from '../../lib/analytics';
import { errorCopy, reportError, toAppError } from '../../lib/appError';
import { haptic } from '../../lib/haptics';
import {
  markRecoveryInProgress,
  clearRecoveryInProgress,
} from '../../lib/passwordRecovery';

const CODE_LENGTH = 6;
const MIN_PASSWORD = 6;
const RESEND_COOLDOWN_S = 30;

export default function ResetPasswordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { email: emailParam } = useLocalSearchParams<{ email?: string }>();

  // 'request' collects the email and sends the code; 'verify' collects the code
  // and the new password. The email is editable in 'request' so a typo caught
  // here doesn't send the user back to the login screen.
  const [step, setStep] = useState<'request' | 'verify'>('request');
  const [email, setEmail] = useState((emailParam ?? '').trim());
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  // Once the code is accepted we hold a live recovery session; a failure while
  // saving the password should let the user retry updateUser WITHOUT re-entering
  // (and re-consuming) the one-shot code.
  const codeVerified = useRef(false);

  // The recovery latch must never outlive this screen — clear it on unmount so
  // a back-swipe mid-flow can't leave the auth gate frozen.
  useEffect(() => () => clearRecoveryInProgress(), []);

  // Resend cooldown ticker.
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
  const clearError = () => { if (formError) setFormError(null); };

  async function sendCode() {
    const trimmed = email.trim();
    if (!trimmed) {
      showError('Enter your email to get a reset code.');
      return;
    }
    setFormError(null);
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(trimmed);
    setLoading(false);
    if (error) {
      const appErr = toAppError(error);
      reportError(appErr, 'auth');
      showError(errorCopy(appErr, { context: 'auth' }).message);
      return;
    }
    track('auth_password_reset_code_sent', {});
    setEmail(trimmed);
    setStep('verify');
    setCooldown(RESEND_COOLDOWN_S);
  }

  async function resendCode() {
    if (cooldown > 0 || loading) return;
    setFormError(null);
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
    setLoading(false);
    if (error) {
      const appErr = toAppError(error);
      reportError(appErr, 'auth');
      showError(errorCopy(appErr, { context: 'auth' }).message);
      return;
    }
    track('auth_password_reset_code_sent', { resend: true });
    setCooldown(RESEND_COOLDOWN_S);
  }

  async function submitNewPassword() {
    if (code.trim().length !== CODE_LENGTH) {
      showError(`Enter the ${CODE_LENGTH}-digit code from your email.`);
      return;
    }
    if (password.length < MIN_PASSWORD) {
      showError(`Your new password needs at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      showError('Those passwords don’t match. Try again.');
      return;
    }

    setFormError(null);
    setLoading(true);
    // Hold the auth gate: verifyOtp creates a session the instant the code is
    // accepted, and the gate would otherwise route into the app before the new
    // password is committed.
    markRecoveryInProgress();

    // 1. Verify the code (skipped on a retry — the session is already live).
    if (!codeVerified.current) {
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: 'recovery',
      });
      if (error) {
        clearRecoveryInProgress();
        setLoading(false);
        const appErr = toAppError(error);
        reportError(appErr, 'auth');
        track('auth_password_reset_failed', { reason: appErr.detailKey ?? appErr.kind, step: 'verify' });
        showError('That code didn’t match, or it expired. Check it and try again, or resend a new one.');
        return;
      }
      codeVerified.current = true;
    }

    // 2. Commit the new password. On failure keep the latch set so the user can
    //    retry this step without burning the (already-consumed) code.
    const { error: updateErr } = await supabase.auth.updateUser({ password });
    if (updateErr) {
      setLoading(false);
      const appErr = toAppError(updateErr);
      reportError(appErr, 'auth');
      track('auth_password_reset_failed', { reason: appErr.detailKey ?? appErr.kind, step: 'update' });
      showError(errorCopy(appErr, { context: 'auth' }).message);
      return;
    }

    clearRecoveryInProgress();
    haptic.success();
    track('auth_password_reset_succeeded', {});
    // Session is live and the password is set — drop straight into the app.
    router.replace('/(tabs)');
  }

  const isVerify = step === 'verify';

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
              RESET <Text style={styles.headlineHighlight}>PASSWORD.</Text>
            </Text>
            <Text style={styles.subhead}>
              {isVerify
                ? `Enter the ${CODE_LENGTH}-digit code we sent to ${email}, then choose a new password.`
                : 'Enter your email and we’ll send a 6-digit code to reset your password.'}
            </Text>

            <Animated.View style={shakeStyle}>
              {!isVerify ? (
                /* ── Step 1: request ── */
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
                    onChangeText={(v) => { clearError(); setEmail(v); }}
                    autoCapitalize="none"
                    keyboardType="email-address"
                  />
                </View>
              ) : (
                /* ── Step 2: verify + new password ── */
                <>
                  <View style={[styles.inputContainer, formError && styles.inputContainerError]}>
                    <MaterialIcons name="pin" size={18} color={color.navy} />
                    <TextInput
                      style={[styles.input, styles.codeInput]}
                      placeholder="6-digit code"
                      placeholderTextColor={color.slateFaint}
                      value={code}
                      onChangeText={(v) => { clearError(); setCode(v.replace(/[^0-9]/g, '').slice(0, CODE_LENGTH)); }}
                      keyboardType="number-pad"
                      maxLength={CODE_LENGTH}
                    />
                  </View>

                  <View style={[styles.inputContainer, formError && styles.inputContainerError]}>
                    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                      <Rect x={4} y={11} width={16} height={10} rx={2} stroke={color.navy} strokeWidth={1.8} />
                      <Path d="M8 11V8a4 4 0 018 0v3" stroke={color.navy} strokeWidth={1.8} />
                    </Svg>
                    <TextInput
                      style={styles.input}
                      placeholder="New password"
                      placeholderTextColor={color.slateFaint}
                      value={password}
                      onChangeText={(v) => { clearError(); setPassword(v); }}
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                    />
                    <TouchableOpacity
                      onPress={() => setShowPassword((s) => !s)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <MaterialIcons
                        name={showPassword ? 'visibility-off' : 'visibility'}
                        size={20}
                        color={color.slateFaint}
                      />
                    </TouchableOpacity>
                  </View>

                  <View style={[styles.inputContainer, formError && styles.inputContainerError]}>
                    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                      <Rect x={4} y={11} width={16} height={10} rx={2} stroke={color.navy} strokeWidth={1.8} />
                      <Path d="M8 11V8a4 4 0 018 0v3" stroke={color.navy} strokeWidth={1.8} />
                    </Svg>
                    <TextInput
                      style={styles.input}
                      placeholder="Confirm new password"
                      placeholderTextColor={color.slateFaint}
                      value={confirm}
                      onChangeText={(v) => { clearError(); setConfirm(v); }}
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                    />
                  </View>
                </>
              )}
            </Animated.View>

            {formError && (
              <View style={styles.errorRow}>
                <MaterialIcons name="error-outline" size={15} color={color.error} />
                <Text style={styles.errorText}>{formError}</Text>
              </View>
            )}

            <PawtchiButton
              title={isVerify ? 'Set new password' : 'Send code'}
              variant="primary"
              iconName="arrow-forward"
              iconPosition="right"
              loading={loading}
              onPress={isVerify ? submitNewPassword : sendCode}
              style={styles.cta}
            />

            {isVerify && (
              <>
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
              </>
            )}
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
