import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { Colors } from '../../constants/Theme';

export default function LoginScreen() {
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode: string }>();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(mode === 'signup');

  async function signInWithEmail() {
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email,
      password: password,
    });

    setLoading(false);
    if (error) {
      Alert.alert('Login Failed', error.message);
    } else {
      router.replace('/(tabs)');
    }
  }

  async function handleForgotPassword() {
    const emailTrimmed = email.trim();
    if (!emailTrimmed) {
      Alert.alert('Enter your email', 'Type your email address above, then tap Forgot Password.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(emailTrimmed);
    setLoading(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      Alert.alert('Check your inbox', `A password reset link has been sent to ${emailTrimmed}.`);
    }
  }

  async function signUpWithEmail() {
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
      Alert.alert('Registration Failed', error.message);
    } else if (data.session === null) {
      Alert.alert('Check your inbox', 'Please check your inbox for email verification!');
    } else {
      // Route to tabs — the tabs layout handles the "no pet → onboarding" redirect
      router.replace('/(tabs)');
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <View style={styles.header}>
          <Text style={styles.brand}>PAWTCHI</Text>
          <Text style={styles.headline}>
            {isSignUp ? 'Join the movement.' : 'Welcome back.'}
          </Text>
          <Text style={styles.subtext}>
            {isSignUp ? 'Create an account to start tracking your pet\'s health journey.' : 'Log in to continue your daily habit loop.'}
          </Text>
        </View>

        <View style={styles.form}>
          <View style={styles.inputContainer}>
            <MaterialIcons name="email" size={20} color="#6C757D" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Email address"
              placeholderTextColor="#ADB5BD"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
          </View>

          <View style={styles.inputContainer}>
            <MaterialIcons name="lock" size={20} color="#6C757D" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor="#ADB5BD"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
            />
          </View>

          <TouchableOpacity 
            style={[styles.primaryBtn, loading && styles.primaryBtnDisabled]}
            disabled={loading}
            onPress={isSignUp ? signUpWithEmail : signInWithEmail}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#000" />
            ) : (
              <>
                <Text style={styles.primaryBtnText}>{isSignUp ? 'Create Account' : 'Sign In'}</Text>
                <MaterialIcons name="arrow-forward" size={20} color="#000" />
              </>
            )}
          </TouchableOpacity>

          <View style={styles.toggleContainer}>
            <Text style={styles.toggleText}>
              {isSignUp ? 'Already have an account?' : 'New to PAWTCHI?'}
            </Text>
            <TouchableOpacity onPress={() => setIsSignUp(!isSignUp)} disabled={loading}>
              <Text style={styles.toggleBtnText}>
                {isSignUp ? 'Sign In' : 'Register'}
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
    backgroundColor: '#FAFAFA',
  },
  keyboardView: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  header: {
    marginBottom: 48,
  },
  brand: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 16,
    letterSpacing: 2,
    marginBottom: 24,
    color: '#000',
  },
  headline: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 40,
    letterSpacing: -1,
    color: '#000',
    marginBottom: 8,
  },
  subtext: {
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 16,
    color: '#6C757D',
    lineHeight: 24,
  },
  form: {
    gap: 16,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E9ECEF',
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 64,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 16,
    color: '#000',
    height: '100%',
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFC00',
    height: 64,
    borderRadius: 32,
    gap: 12,
    marginTop: 8,
    shadowColor: '#FFFC00',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
  primaryBtnDisabled: {
    opacity: 0.7,
  },
  primaryBtnText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 18,
    color: '#000',
  },
  toggleContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginTop: 24,
  },
  toggleText: {
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 14,
    color: '#6C757D',
  },
  toggleBtnText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 14,
    color: '#000',
  },
  forgotBtn: {
    alignItems: 'center',
    marginTop: 8,
    paddingVertical: 8,
  },
  forgotText: {
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 14,
    fontWeight: '600',
    color: '#6C757D',
    textDecorationLine: 'underline',
  },
});
