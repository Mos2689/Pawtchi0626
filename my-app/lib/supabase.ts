import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import { processLock } from '@supabase/auth-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://YOUR_SUPABASE_URL.supabase.co';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY';

const MemoryStorage = {
  getItem: (key: string) => Promise.resolve(null),
  setItem: (key: string, value: string) => Promise.resolve(),
  removeItem: (key: string) => Promise.resolve(),
};

// Wrap AsyncStorage in a timeout to prevent React Native deadlocks
const SafeStorage = {
  getItem: (key: string) => {
    return Promise.race([
      AsyncStorage.getItem(key),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000))
    ]);
  },
  setItem: (key: string, value: string) => {
    return Promise.race([
      AsyncStorage.setItem(key, value),
      new Promise<void>((resolve) => setTimeout(resolve, 2000))
    ]);
  },
  removeItem: (key: string) => {
    return Promise.race([
      AsyncStorage.removeItem(key),
      new Promise<void>((resolve) => setTimeout(resolve, 2000))
    ]);
  }
};

const customStorage = typeof window === 'undefined' ? MemoryStorage : SafeStorage;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: customStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // Official React Native guidance: serialize auth-state access. Right
    // after sign-in this app fires several supabase calls at once (pet,
    // streak, push-token RPC, context) — without a lock their internal
    // getSession() calls can race the auth client and hang forever, which
    // presented as an Android login stuck on the loader.
    lock: processLock,
  },
});

// Run the token autorefresh only while the app is foregrounded (the other
// half of the official RN setup): a background-suspended refresh can wake up
// mid-request and stall the auth lock the next queries wait on.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
