import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface Props {
  petId: string;
  petName: string;
  petAvatarUrl?: string | null;
  onUpdatePantry: () => void;
  onDismiss: () => void;
}

export default function EmptyPantryNudge({ petId, petName, petAvatarUrl, onUpdatePantry, onDismiss }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const key = `pantry_nudge_${petId}_${today}`;
    AsyncStorage.getItem(key).then((val) => {
      if (!val) setVisible(true);
    });
  }, [petId]);

  const handleDismiss = async () => {
    const today = new Date().toISOString().slice(0, 10);
    const key = `pantry_nudge_${petId}_${today}`;
    await AsyncStorage.setItem(key, '1');
    setVisible(false);
    onDismiss();
  };

  if (!visible) return null;

  return (
    <View style={styles.card}>
      <View style={styles.bubbleRow}>
        {petAvatarUrl ? (
          <Image source={{ uri: petAvatarUrl }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarFallback}>
            <MaterialIcons name="pets" size={24} color="#FFFC00" />
          </View>
        )}
        <View style={styles.bubble}>
          <Text style={styles.bubbleText}>
            Woof! My pantry is empty! Tell me what I'm eating so I can give you the best advice when scanning!
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <TouchableOpacity style={styles.primaryBtn} activeOpacity={0.8} onPress={onUpdatePantry}>
          <MaterialIcons name="inventory-2" size={16} color="#041015" />
          <Text style={styles.primaryBtnText}>Update Pantry</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.ghostBtn} activeOpacity={0.7} onPress={handleDismiss}>
          <Text style={styles.ghostBtnText}>Later</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 24,
    marginBottom: 16,
    marginTop: 4,
    backgroundColor: '#0f172a',
    borderRadius: 20,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  bubbleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1e293b',
  },
  avatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubble: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 16,
    borderTopLeftRadius: 4,
    padding: 12,
  },
  bubbleText: {
    color: '#e2e8f0',
    fontSize: 14,
    lineHeight: 20,
    fontFamily: 'PlusJakartaSans-Medium',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  primaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FFFC00',
    borderRadius: 14,
    paddingVertical: 10,
  },
  primaryBtnText: {
    color: '#041015',
    fontSize: 14,
    fontFamily: 'PlusJakartaSans-Bold',
    fontWeight: '700',
  },
  ghostBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  ghostBtnText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
    fontFamily: 'PlusJakartaSans-Medium',
  },
});
