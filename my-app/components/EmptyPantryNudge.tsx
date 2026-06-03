import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PawtchiButton } from './PawtchiButton';

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
      <Text style={styles.bubbleText}>
        No foods added yet. Add items to the pantry so meal logging is faster next time.
      </Text>
      <View style={styles.actions}>
        <PawtchiButton
          title="Update Pantry"
          iconName="inventory-2"
          onPress={onUpdatePantry}
          size="medium"
          style={{ flex: 1 }}
        />
        <PawtchiButton
          title="Later"
          variant="ghost"
          onPress={handleDismiss}
          size="medium"
          textStyle={{ color: 'rgba(255,255,255,0.5)' }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 24,
    marginBottom: 24,
    marginTop: 0,
    backgroundColor: '#0f172a',
    borderRadius: 24,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  bubbleText: {
    color: '#e2e8f0',
    fontSize: 14,
    lineHeight: 20,
    fontFamily: 'PlusJakartaSans-Medium',
    marginBottom: 16,
    textAlign: 'center',
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
