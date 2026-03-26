import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

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
  },
});
