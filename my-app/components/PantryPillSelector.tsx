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
  onAddNew?: () => void;
}

const FOOD_TYPE_ICONS: Record<string, keyof typeof MaterialIcons.glyphMap> = {
  kibble: 'pets',
  wet_food: 'soup-kitchen',
  treat: 'cookie',
  raw: 'egg-alt',
  supplement: 'medication',
  human_food: 'restaurant',
};

export default function PantryPillSelector({ pantryItems, selectedId, onSelect, onAddNew }: Props) {
  // Auto-select when there's exactly 1 pantry item
  useEffect(() => {
    if (pantryItems.length === 1 && selectedId === null) {
      onSelect(pantryItems[0].id);
    }
  }, [pantryItems.length]);

  return (
    <View style={styles.container}>
      <View style={styles.wrapContent}>
        {/* Default "None / New Food" pill */}
        <TouchableOpacity
          style={[styles.pill, selectedId === null ? styles.pillSelected : styles.pillUnselected]}
          activeOpacity={0.7}
          onPress={() => {
            onSelect(null);
            onAddNew?.();
          }}
        >
          <MaterialIcons
            name={selectedId === null ? 'check-circle' : 'add-circle-outline'}
            size={16}
            color={selectedId === null ? '#041015' : '#475569'}
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
                color={isSelected ? '#041015' : '#475569'}
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    paddingVertical: 12,
  },
  wrapContent: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    gap: 10,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    gap: 8,
    borderWidth: 1.5,
    marginBottom: 4,
  },
  pillUnselected: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  pillSelected: {
    backgroundColor: '#FFFC00',
    borderColor: '#FFFC00',
    shadowColor: '#FFFC00',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  pillText: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans-Bold',
  },
  pillTextUnselected: {
    color: '#475569',
  },
  pillTextSelected: {
    color: '#041015',
  },
});
