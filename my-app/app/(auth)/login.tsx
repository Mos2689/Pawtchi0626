import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { color, font, radius, space } from '../../constants/design';
import { PawtchiButton } from '../../components/PawtchiButton';
import { track } from '../../lib/analytics';

// Auth — a navy brand moment. Same auth logic as before; only the surface
// changed to match the welcome → onboarding arc.
export default function LoginScreen() {
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode: string }>();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(mode === 'signup');
  // Inline error rendered under the form — feels far more crafted than a system Alert
  // at the make-or-break auth moment.
  const [formError, setFormError] = useState<string | null>(null);

  // Clear the inline error whenever the user edits a field or flips modes,
  // so the surface always reflects the current attempt.
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
      track('auth_signin_failed', { reason: error.message });
      setFormError(error.message);
    } else {
      track('auth_signin_succeeded', {});
      router.replace('/(tabs)');
    }
  }

  async function handleForgotPassword() {
    const emailTrimmed = email.trim();
    if (!emailTrimmed) {
      setFormError('Type your email above, then tap Forgot password.');
      return;
    }
    track('auth_forgot_password', {});
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(emailTrimmed);
    setLoading(false);
    if (error) {
      setFormError(error.message);
    } else {
      Alert.alert('Check your inbox', `A password reset link has been sent to ${emailTrimmed}.`);
    }
  }

  async function signUpWithEmail() {
    setFormError(null);
    track('auth_signup_started', {});
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: email,
      password: password,
      options: {
        data: {
          full_name: email.split('@')[0], // Extract a temporary name
        }
      }
    });

    setLoading(false);
    if (error) {
      track('auth_signup_failed', { reason: error.message });
      setFormError(error.message);
    } else if (data.session === null) {
      // No-confirm flow shouldn't hit this branch in production, but keep the
      // graceful path in case verification is ever re-enabled in Supabase.
      setFormError('Account created. Please check your inbox to verify.');
    } else {
      track('auth_signup_succeeded', {});
      // Route to tabs — the tabs layout handles the "no pet → onboarding" redirect
      router.replace('/(tabs)');
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <View style={styles.header}>
          <Text style={styles.brand}>PAWTCHI</Text>
          <Text style={styles.headline}>
            {isSignUp ? 'START\nNOTICING.' : 'WELCOME\nBACK.'}
          </Text>
          <Text style={styles.subtext}>
            {isSignUp
              ? 'Create an account and build the full picture of their health.'
              : 'Sign in to pick up where you left off.'}
          </Text>
        </View>

        <View style={styles.form}>
          <View style={[styles.inputContainer, formError && styles.inputContainerError]}>
            <MaterialIcons name="email" size={20} color={color.creamFaint} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Email address"
              placeholderTextColor={color.creamFaint}
              value={email}
              onChangeText={setEmailClean}
              autoCapitalize="none"
              keyboardType="email-address"
            />
          </View>

          <View style={[styles.inputContainer, formError && styles.inputContainerError]}>
            <MaterialIcons name="lock" size={20} color={color.creamFaint} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={color.creamFaint}
              value={password}
              onChangeText={setPasswordClean}
              secureTextEntry
              autoCapitalize="none"
            />
          </View>

          {formError && (
            <View style={styles.errorRow}>
              <MaterialIcons name="error-outline" size={15} color={color.yellow} />
              <Text style={styles.errorText}>{formError}</Text>
            </View>
          )}

          <PawtchiButton
            title={isSignUp ? 'Create account' : 'Sign in'}
            variant="primary"
            iconName="arrow-forward"
            iconPosition="right"
            loading={loading}
            onPress={isSignUp ? signUpWithEmail : signInWithEmail}
            style={{ marginTop: space.sm }}
          />

          <View style={styles.toggleContainer}>
            <Text style={styles.toggleText}>
              {isSignUp ? 'Already have an account?' : 'New to Pawtchi?'}
            </Text>
            <TouchableOpacity onPress={() => { setIsSignUp(!isSignUp); setFormError(null); }} disabled={loading}>
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
        </View>

      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.navy,
  },
  keyboardView: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: space.xxl,
  },
  header: {
    marginBottom: 40,
  },
  brand: {
    fontFamily: font.display,
    fontSize: 18,
    letterSpacing: 3,
    marginBottom: space.xxl,
    color: color.creamDim,
  },
  headline: {
    fontFamily: font.display,
    fontSize: 48,
    lineHeight: 46,
    letterSpacing: 1,
    color: color.cream,
    marginBottom: space.md,
  },
  subtext: {
    fontFamily: font.regular,
    fontSize: 15,
    color: color.creamDim,
    lineHeight: 22,
    maxWidth: 320,
  },
  form: {
    gap: space.lg,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.navyRaised,
    borderWidth: 1,
    borderColor: color.hairlineOnNavy,
    borderRadius: radius.lg,
    paddingHorizontal: space.lg,
    height: 56,
  },
  inputContainerError: {
    borderColor: color.yellow,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
  },
  errorText: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 13,
    color: color.yellow,
    lineHeight: 18,
  },
  inputIcon: {
    marginRight: space.md,
  },
  input: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 15,
    color: color.cream,
    height: '100%',
  },
  toggleContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space.sm,
    marginTop: space.xl,
  },
  toggleText: {
    fontFamily: font.regular,
    fontSize: 14,
    color: color.creamDim,
  },
  toggleBtnText: {
    fontFamily: font.bold,
    fontSize: 14,
    color: color.yellow,
  },
  forgotBtn: {
    alignItems: 'center',
    marginTop: space.sm,
    paddingVertical: space.sm,
  },
  forgotText: {
    fontFamily: font.medium,
    fontSize: 14,
    color: color.creamDim,
    textDecorationLine: 'underline',
  },
});
