import React, { useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

interface PantryItem {
  id: string;
  brand: string;
  product_name: string;
  food_type: 'kibble' | 'wet_food' | 'treat' | 'raw' | 'supplement' | 'human_food';
  is_primary: boolean;
  image_url?: string;
}

interface Props {
  pantryItems: PantryItem[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

const FOOD_TYPE_ICONS: Record<string, keyof typeof MaterialIcons.glyphMap> = {
  kibble: 'pets',
  wet_food: 'soup-kitchen',
  treat: 'cookie',
  raw: 'egg-alt',
  supplement: 'medication',
  human_food: 'restaurant',
};

export default function PantryPillSelector({ pantryItems, selectedId, onSelect }: Props) {
  // Auto-select when there's exactly 1 pantry item
  useEffect(() => {
    if (pantryItems.length === 1 && selectedId === null) {
      onSelect(pantryItems[0].id);
    }
  }, [pantryItems.length]);

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Default "None / New Food" pill */}
        <TouchableOpacity
          style={[styles.pill, selectedId === null ? styles.pillSelected : styles.pillUnselected]}
          activeOpacity={0.7}
          onPress={() => onSelect(null)}
        >
          <MaterialIcons
            name={selectedId === null ? 'check-circle' : 'add-circle-outline'}
            size={16}
            color={selectedId === null ? '#041015' : '#FFFFFF'}
          />
          <Text style={[styles.pillText, selectedId === null ? styles.pillTextSelected : styles.pillTextUnselected]}>
            New Food
          </Text>
        </TouchableOpacity>

        {/* Pantry item pills */}
        {pantryItems.map((item) => {
          const isSelected = selectedId === item.id;
          const icon = FOOD_TYPE_ICONS[item.food_type] || 'pets';
          const label = item.brand.length > 15 ? item.brand.slice(0, 14) + '…' : item.brand;

          return (
            <TouchableOpacity
              key={item.id}
              style={[styles.pill, isSelected ? styles.pillSelected : styles.pillUnselected]}
              activeOpacity={0.7}
              onPress={() => onSelect(item.id)}
            >
              <MaterialIcons
                name={isSelected ? 'check-circle' : icon}
                size={16}
                color={isSelected ? '#041015' : '#FFFFFF'}
              />
              <Text
                style={[styles.pillText, isSelected ? styles.pillTextSelected : styles.pillTextUnselected]}
                numberOfLines={1}
              >
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 72,
    left: 0,
    right: 0,
    zIndex: 5,
    backgroundColor: 'rgba(0,0,0,0.3)',
    paddingVertical: 8,
  },
  scrollContent: {
    paddingHorizontal: 12,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  pillUnselected: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  pillSelected: {
    backgroundColor: '#FFFC00',
    borderWidth: 1,
    borderColor: '#FFFC00',
  },
  pillText: {
    fontSize: 13,
    fontFamily: 'PlusJakartaSans-SemiBold',
  },
  pillTextUnselected: {
    color: '#FFFFFF',
  },
  pillTextSelected: {
    color: '#041015',
    fontWeight: '700',
  },
});
