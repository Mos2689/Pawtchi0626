import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'pawtchi.community.pendingInviteCode.v1';

export async function rememberCommunityInviteCode(code: string): Promise<void> {
  const clean = code.trim();
  if (clean) await AsyncStorage.setItem(KEY, clean);
}

export async function takeCommunityInviteCode(): Promise<string | null> {
  const value = await AsyncStorage.getItem(KEY);
  if (value) await AsyncStorage.removeItem(KEY);
  return value;
}

export async function clearCommunityInviteCode(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}
