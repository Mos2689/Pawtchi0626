/**
 * BreedPickerModal — the breed sheet, lifted out of body-basics so the
 * walk-first identity screen uses the same one.
 *
 * Extracted rather than reimplemented: breed feeds the metabolic modifier in
 * the calorie maths and the size category in walk pace calibration, and both
 * read the string. A second picker with a slightly different list would put
 * "Labrador" in one screen and "Labrador Retriever" in the other and quietly
 * break the lookup.
 *
 * Search doubles as free text — a typed value with no preset match is offered
 * as "Use …", because the list will never cover every mix and refusing the
 * owner's own word for their dog is worse than an unmatched string.
 */

import React, { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

import { color, font, motion, radius, space } from '../constants/design';
import { breedsFor } from '../constants/breeds';
import { AnimatedPressable } from './AnimatedPressable';
import { SelectableChip } from './SelectableChip';

interface BreedPickerModalProps {
  visible: boolean;
  species: 'dog' | 'cat' | null | undefined;
  /** Currently chosen breed, so the sheet can tick it. */
  value: string;
  onSelect: (breed: string) => void;
  onClose: () => void;
}

export function BreedPickerModal({
  visible,
  species,
  value,
  onSelect,
  onClose,
}: BreedPickerModalProps) {
  const [search, setSearch] = useState('');

  const options = breedsFor(species);
  const query = search.trim();
  const filtered = useMemo(
    () => (query ? options.filter(b => b.toLowerCase().includes(query.toLowerCase())) : options),
    [options, query],
  );
  const hasExactMatch = query
    ? options.some(b => b.toLowerCase() === query.toLowerCase())
    : false;
  const showCustomOption = query.length > 0 && !hasExactMatch;

  const pick = (breed: string) => {
    onSelect(breed);
    setSearch('');
    onClose();
  };

  const close = () => {
    setSearch('');
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.modalOverlay}
      >
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select breed</Text>
            <TouchableOpacity onPress={close}>
              <MaterialIcons name="close" size={22} color={color.ink} />
            </TouchableOpacity>
          </View>

          <View style={styles.breedSearchWrap}>
            <MaterialIcons name="search" size={18} color={color.slateFaint} />
            <TextInput
              style={styles.breedSearchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Search or type and Add+ your own breed"
              placeholderTextColor={color.slateFaint}
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={() => {
                if (showCustomOption) pick(query);
              }}
            />
            {search.length > 0 && (
              <TouchableOpacity
                onPress={() => setSearch('')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MaterialIcons name="close" size={16} color={color.slateFaint} />
              </TouchableOpacity>
            )}
          </View>

          <ScrollView
            style={{ maxHeight: 440 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {showCustomOption && (
              <AnimatedPressable
                style={[styles.modalItem, styles.breedCustomItem]}
                haptic="select"
                scaleTo={motion.scale.press}
                onPress={() => pick(query)}
              >
                <View style={styles.customRow}>
                  <MaterialIcons name="add-circle-outline" size={18} color={color.navy} />
                  <Text style={[styles.modalItemText, styles.customText]} numberOfLines={1}>
                    Use “{query}”
                  </Text>
                </View>
              </AnimatedPressable>
            )}

            {filtered.length === 0 && !showCustomOption && (
              <Text style={styles.breedEmpty}>No matches. Try a different spelling.</Text>
            )}

            {filtered.map(b => (
              <SelectableChip
                key={b}
                selected={value === b}
                style={styles.modalItem}
                scaleTo={motion.scale.press}
                onPress={() => pick(b)}
              >
                <Text style={[styles.modalItemText, value === b && styles.modalItemTextSelected]}>
                  {b}
                </Text>
                {value === b && <MaterialIcons name="check" size={18} color={color.navy} />}
              </SelectableChip>
            ))}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(7, 32, 42, 0.55)' },
  modalContent: {
    backgroundColor: color.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: space.xxl,
    paddingTop: space.lg,
    paddingBottom: 32,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.lg,
  },
  modalTitle: { fontFamily: font.bold, fontSize: 18, color: color.ink },
  modalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: color.hairline,
  },
  modalItemText: {
    fontFamily: font.medium,
    fontSize: 15,
    color: color.slate,
  },
  modalItemTextSelected: {
    fontFamily: font.bold,
    color: color.ink,
  },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flex: 1,
  },
  customText: {
    color: color.ink,
    fontFamily: font.semibold,
  },
  breedSearchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.hairline,
    paddingHorizontal: 14,
    height: 46,
    marginBottom: space.md,
  },
  breedSearchInput: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 14.5,
    color: color.ink,
    paddingVertical: 0,
    includeFontPadding: false,
  },
  breedCustomItem: {
    backgroundColor: color.yellowSoft,
    borderBottomWidth: 0,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    marginBottom: space.sm,
  },
  breedEmpty: {
    fontFamily: font.medium,
    fontSize: 13.5,
    color: color.slateFaint,
    paddingVertical: space.lg,
    textAlign: 'center',
  },
});
