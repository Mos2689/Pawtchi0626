import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useActivePetStore } from '../store/useActivePetStore';
import { supabase } from '../lib/supabase';
import { KIBBLE_BRANDS, TREAT_BRANDS, WET_FOOD_BRANDS, BOWL_SIZES } from '../constants/brandData';

export default function MedicalProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { activePet, fetchPet } = useActivePetStore();

  const [loading, setLoading] = useState(false);

  // States
  const [bcs, setBcs] = useState(activePet?.body_condition_score?.toString() || '');
  const [diet, setDiet] = useState<string[]>(activePet?.diet_type || []);
  const [customDiet, setCustomDiet] = useState('');
  const [allergies, setAllergies] = useState(activePet?.allergies?.join(', ') || '');
  const [conditions, setConditions] = useState(activePet?.medical_conditions?.join(', ') || '');

  // Food brand states
  const [kibbleBrands, setKibbleBrands] = useState<string[]>(activePet?.food_brands?.kibble || []);
  const [treatBrands, setTreatBrands] = useState<string[]>(activePet?.food_brands?.treats || []);
  const [wetFoodBrands, setWetFoodBrands] = useState<string[]>(activePet?.food_brands?.wet_food || []);
  const [bowlSize, setBowlSize] = useState(activePet?.bowl_size || '');

  // Brand modal states
  const [brandModalVisible, setBrandModalVisible] = useState(false);
  const [brandModalCategory, setBrandModalCategory] = useState<'kibble' | 'treats' | 'wet_food'>('kibble');
  const [brandSearch, setBrandSearch] = useState('');
  const [brandCustom, setBrandCustom] = useState('');

  const [dietModalVisible, setDietModalVisible] = useState(false);
  const DIET_OPTIONS = [
    { label: 'Kibble (Dry)', value: 'kibble' },
    { label: 'Wet Food', value: 'wet' },
    { label: 'Raw Diet', value: 'raw' },
    { label: 'Fresh Cooked', value: 'fresh' },
    { label: 'Mixed', value: 'mixed' }
  ];

  const handleSave = async () => {
    if (!activePet) return;
    setLoading(true);

    // Parse strings to arrays
    const formattedAllergies = allergies.split(',').map(s => s.trim()).filter(Boolean);
    const formattedConditions = conditions.split(',').map(s => s.trim()).filter(Boolean);
    const parsedBcs = parseInt(bcs);

    const { error } = await supabase
      .from('pets')
      .update({
        body_condition_score: isNaN(parsedBcs) ? null : parsedBcs,
        allergies: formattedAllergies.length > 0 ? formattedAllergies : null,
        medical_conditions: formattedConditions.length > 0 ? formattedConditions : null,
        diet_type: diet.length > 0 ? diet : null,
        food_brands: {
          kibble: kibbleBrands,
          treats: treatBrands,
          wet_food: wetFoodBrands,
          other: activePet?.food_brands?.other || [],
        },
        bowl_size: bowlSize || null,
      })
      .eq('id', activePet.id);

    setLoading(false);

    if (error) {
      Alert.alert("Data Error", error.message);
    } else {
      await fetchPet(activePet.owner_id);
      router.back();
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 120 }]} showsVerticalScrollIndicator={false}>

          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
              <MaterialIcons name="close" size={28} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          <View style={styles.titleSection}>
            <MaterialIcons name="health-and-safety" size={48} color="#FFFC00" style={{ marginBottom: 16 }} />
            <Text style={styles.mainTitle}>Clinical File</Text>
            <Text style={styles.subTitle}>Unlock specialized AI analysis for {activePet?.name || 'your pet'}.</Text>
          </View>

          <View style={styles.formContainer}>

            {/* Body Condition Score */}
            <View style={styles.inputGroup}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>Body Condition Score (BCS)</Text>
                <View style={styles.badge}><Text style={styles.badgeText}>1-9 SCALE</Text></View>
              </View>
              <Text style={styles.helperText}>4-5 is ideal. 1 is emaciated, 9 is severely obese.</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 5"
                  placeholderTextColor="#64748b"
                  keyboardType="numeric"
                  value={bcs}
                  onChangeText={setBcs}
                  maxLength={1}
                />
              </View>
            </View>

            {/* Diet Type */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Primary Diet</Text>
              <TouchableOpacity
                style={[styles.inputWrapper, { paddingHorizontal: 20, justifyContent: 'center' }]}
                onPress={() => setDietModalVisible(true)}
                activeOpacity={0.7}
              >
                <Text style={[{ fontFamily: 'Plus Jakarta Sans', fontWeight: '600', fontSize: 16 }, diet.length > 0 ? { color: '#FFFFFF' } : { color: '#64748b' }]} numberOfLines={1}>
                  {diet.length > 0 ? diet.join(', ') : "Select diet types..."}
                </Text>
                <MaterialIcons name="expand-more" size={24} color="#94a3b8" style={{ position: 'absolute', right: 20 }} />
              </TouchableOpacity>
            </View>

            {/* Allergies */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Known Allergies</Text>
              <Text style={styles.helperText}>Separate with commas (e.g. Chicken, Grains, Beef)</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.input}
                  placeholder="None"
                  placeholderTextColor="#64748b"
                  value={allergies}
                  onChangeText={setAllergies}
                />
              </View>
            </View>

            {/* Medical Conditions */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Chronic Conditions</Text>
              <Text style={styles.helperText}>Separate with commas (e.g. Arthritis, Diabetes)</Text>
              <View style={[styles.inputWrapper, { height: 100 }]}>
                <TextInput
                  style={[styles.input, { height: '100%', textAlignVertical: 'top', paddingTop: 16 }]}
                  placeholder="None"
                  placeholderTextColor="#64748b"
                  multiline
                  value={conditions}
                  onChangeText={setConditions}
                />
              </View>
            </View>


            {/* Food Brands */}
            <View style={styles.inputGroup}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>Food Brands</Text>
                <View style={styles.badge}><Text style={styles.badgeText}>AI CONTEXT</Text></View>
              </View>
              <Text style={styles.helperText}>Helps the scanner give brand-specific nutrition analysis</Text>

              {/* Kibble */}
              <TouchableOpacity
                style={[styles.inputWrapper, { paddingHorizontal: 20, justifyContent: 'center', marginTop: 8 }]}
                onPress={() => { setBrandModalCategory('kibble'); setBrandModalVisible(true); }}
                activeOpacity={0.7}
              >
                <Text style={[{ fontFamily: 'Plus Jakarta Sans', fontWeight: '600', fontSize: 14, color: '#94a3b8' }]}>KIBBLE</Text>
                <Text style={[{ fontFamily: 'Plus Jakarta Sans', fontWeight: '600', fontSize: 14 }, kibbleBrands.length > 0 ? { color: '#FFFFFF' } : { color: '#64748b' }]} numberOfLines={1}>
                  {kibbleBrands.length > 0 ? kibbleBrands.join(', ') : 'Select brands...'}
                </Text>
                <MaterialIcons name="expand-more" size={24} color="#94a3b8" style={{ position: 'absolute', right: 20 }} />
              </TouchableOpacity>

              {/* Treats */}
              <TouchableOpacity
                style={[styles.inputWrapper, { paddingHorizontal: 20, justifyContent: 'center', marginTop: 8 }]}
                onPress={() => { setBrandModalCategory('treats'); setBrandModalVisible(true); }}
                activeOpacity={0.7}
              >
                <Text style={[{ fontFamily: 'Plus Jakarta Sans', fontWeight: '600', fontSize: 14, color: '#94a3b8' }]}>TREATS</Text>
                <Text style={[{ fontFamily: 'Plus Jakarta Sans', fontWeight: '600', fontSize: 14 }, treatBrands.length > 0 ? { color: '#FFFFFF' } : { color: '#64748b' }]} numberOfLines={1}>
                  {treatBrands.length > 0 ? treatBrands.join(', ') : 'Select brands...'}
                </Text>
                <MaterialIcons name="expand-more" size={24} color="#94a3b8" style={{ position: 'absolute', right: 20 }} />
              </TouchableOpacity>

              {/* Wet Food */}
              <TouchableOpacity
                style={[styles.inputWrapper, { paddingHorizontal: 20, justifyContent: 'center', marginTop: 8 }]}
                onPress={() => { setBrandModalCategory('wet_food'); setBrandModalVisible(true); }}
                activeOpacity={0.7}
              >
                <Text style={[{ fontFamily: 'Plus Jakarta Sans', fontWeight: '600', fontSize: 14, color: '#94a3b8' }]}>WET FOOD</Text>
                <Text style={[{ fontFamily: 'Plus Jakarta Sans', fontWeight: '600', fontSize: 14 }, wetFoodBrands.length > 0 ? { color: '#FFFFFF' } : { color: '#64748b' }]} numberOfLines={1}>
                  {wetFoodBrands.length > 0 ? wetFoodBrands.join(', ') : 'Select brands...'}
                </Text>
                <MaterialIcons name="expand-more" size={24} color="#94a3b8" style={{ position: 'absolute', right: 20 }} />
              </TouchableOpacity>
            </View>

            {/* Bowl Size */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Bowl Size</Text>
              <Text style={styles.helperText}>Used to estimate portions when scanning food</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                {BOWL_SIZES.map(s => (
                  <TouchableOpacity
                    key={s.value}
                    style={[styles.inputWrapper, { width: 'auto', height: 44, paddingHorizontal: 16, justifyContent: 'center', borderColor: bowlSize === s.value ? '#FFFC00' : 'rgba(255,255,255,0.1)' }]}
                    onPress={() => setBowlSize(s.value)}
                  >
                    <Text style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: bowlSize === s.value ? '800' : '600', fontSize: 14, color: bowlSize === s.value ? '#FFFC00' : '#f8fafc' }}>
                      {s.label} ({s.description})
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

          </View>
        </ScrollView>

        {/* Brand Selection Modal */}
        <Modal visible={brandModalVisible} animationType="fade" transparent={true}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => { setBrandModalVisible(false); setBrandSearch(''); }}>
              <TouchableOpacity activeOpacity={1} style={[styles.modalContent, { maxHeight: '80%' }]}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>
                    {brandModalCategory === 'kibble' ? 'Kibble Brands' : brandModalCategory === 'treats' ? 'Treat Brands' : 'Wet Food Brands'}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, marginHorizontal: 16, marginBottom: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                  <MaterialIcons name="search" size={20} color="#64748b" style={{ marginLeft: 12 }} />
                  <TextInput
                    style={{ flex: 1, height: 44, paddingHorizontal: 8, color: '#FFFFFF', fontFamily: 'Plus Jakarta Sans', fontSize: 15 }}
                    placeholder="Search..."
                    placeholderTextColor="#64748b"
                    value={brandSearch}
                    onChangeText={setBrandSearch}
                  />
                </View>
                <ScrollView style={styles.modalScroll}>
                  {(brandModalCategory === 'kibble' ? KIBBLE_BRANDS : brandModalCategory === 'treats' ? TREAT_BRANDS : WET_FOOD_BRANDS)
                    .filter(b => !brandSearch.trim() || b.toLowerCase().includes(brandSearch.toLowerCase()))
                    .map(brand => {
                      const currentList = brandModalCategory === 'kibble' ? kibbleBrands : brandModalCategory === 'treats' ? treatBrands : wetFoodBrands;
                      const isSelected = currentList.includes(brand);
                      return (
                        <TouchableOpacity
                          key={brand}
                          style={styles.modalItem}
                          onPress={() => {
                            const setter = brandModalCategory === 'kibble' ? setKibbleBrands : brandModalCategory === 'treats' ? setTreatBrands : setWetFoodBrands;
                            if (isSelected) setter(currentList.filter(b => b !== brand));
                            else setter([...currentList, brand]);
                          }}
                        >
                          <Text style={[styles.modalItemText, isSelected && { color: '#FFFC00', fontWeight: '800' }]}>{brand}</Text>
                          {isSelected && <MaterialIcons name="check" size={20} color="#FFFC00" />}
                        </TouchableOpacity>
                      );
                    })
                  }
                  {/* Custom Brand */}
                  <View style={[styles.modalItem, { flexDirection: 'column', alignItems: 'flex-start', borderBottomWidth: 0, marginTop: 8 }]}>
                    <Text style={[styles.label, { color: '#94a3b8', marginLeft: 0, marginBottom: 8 }]}>Custom Brand</Text>
                    <View style={{ flexDirection: 'row', gap: 8, width: '100%' }}>
                      <View style={[styles.inputWrapper, { flex: 1, height: 44, borderColor: 'rgba(255,255,255,0.1)' }]}>
                        <TextInput
                          style={[styles.input, { fontSize: 14 }]}
                          placeholder="Type brand name..."
                          placeholderTextColor="#64748b"
                          value={brandCustom}
                          onChangeText={setBrandCustom}
                          onSubmitEditing={() => {
                            const val = brandCustom.trim();
                            if (!val) return;
                            const setter = brandModalCategory === 'kibble' ? setKibbleBrands : brandModalCategory === 'treats' ? setTreatBrands : setWetFoodBrands;
                            const currentList = brandModalCategory === 'kibble' ? kibbleBrands : brandModalCategory === 'treats' ? treatBrands : wetFoodBrands;
                            if (!currentList.includes(val)) setter([...currentList, val]);
                            setBrandCustom('');
                          }}
                        />
                      </View>
                    </View>
                  </View>
                </ScrollView>
                <View style={{ padding: 16 }}>
                  <TouchableOpacity
                    style={[styles.saveBtn, { height: 48, shadowOpacity: 0 }]}
                    onPress={() => { setBrandModalVisible(false); setBrandSearch(''); }}
                  >
                    <LinearGradient colors={['#FFFC00', '#e6e300']} style={styles.saveGradient}>
                      <Text style={[styles.saveBtnText, { fontSize: 16 }]}>Done</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        </Modal>
        {/* Diet Selection Action Sheet Modal (Multi-Select) */}
        <Modal visible={dietModalVisible} animationType="fade" transparent={true}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setDietModalVisible(false)}>
              <TouchableOpacity activeOpacity={1} style={[styles.modalContent, { maxHeight: '80%' }]}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Diet Types</Text>
                </View>
                <ScrollView style={styles.modalScroll}>
                  {DIET_OPTIONS.map(opt => {
                    const isSelected = diet.includes(opt.label);
                    return (
                      <TouchableOpacity
                        key={opt.value}
                        style={styles.modalItem}
                        onPress={() => {
                          if (isSelected) setDiet(diet.filter(d => d !== opt.label));
                          else setDiet([...diet, opt.label]);
                        }}
                      >
                        <Text style={[styles.modalItemText, isSelected && { color: '#FFFC00', fontWeight: '800' }]}>{opt.label}</Text>
                        {isSelected && <MaterialIcons name="check" size={20} color="#FFFC00" />}
                      </TouchableOpacity>
                    );
                  })}

                  {/* Custom Diet Input */}
                  <View style={[styles.modalItem, { flexDirection: 'column', alignItems: 'flex-start', borderBottomWidth: 0, marginTop: 8 }]}>
                    <Text style={[styles.label, { color: '#94a3b8', marginLeft: 0, marginBottom: 8 }]}>Other / Custom Diet</Text>
                    <View style={[styles.inputWrapper, { height: 48, borderColor: 'rgba(255,255,255,0.1)' }]}>
                      <TextInput
                        style={[styles.input, { fontSize: 14 }]}
                        placeholder="e.g. Prescription Renal"
                        placeholderTextColor="#64748b"
                        value={customDiet}
                        onChangeText={setCustomDiet}
                        onEndEditing={(e) => {
                          const val = e.nativeEvent.text.trim();
                          if (val && !diet.includes(val)) {
                            setDiet([...diet, val]);
                            setCustomDiet('');
                          }
                        }}
                      />
                    </View>
                  </View>

                </ScrollView>
                <View style={{ padding: 16 }}>
                  <TouchableOpacity
                    style={[styles.saveBtn, { height: 48, shadowOpacity: 0 }]}
                    onPress={() => setDietModalVisible(false)}
                  >
                    <LinearGradient colors={['#FFFC00', '#e6e300']} style={styles.saveGradient}>
                      <Text style={[styles.saveBtnText, { fontSize: 16 }]}>Done</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        </Modal>

        {/* Sticky Footer */}
        <View style={[styles.footer, { paddingBottom: insets.bottom || 24 }]}>
          <TouchableOpacity
            style={[styles.saveBtn, { opacity: loading ? 0.7 : 1 }]}
            onPress={handleSave}
            disabled={loading}
          >
            <LinearGradient
              colors={['#FFFC00', '#e6e300']}
              style={styles.saveGradient}
            >
              {loading ? (
                <ActivityIndicator color="#000000" />
              ) : (
                <Text style={styles.saveBtnText}>Save Clinical Profile</Text>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </View>

      </KeyboardAvoidingView>
    </View >
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a', // Deep clinical dark mode
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
    alignItems: 'flex-end',
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  titleSection: {
    marginBottom: 40,
  },
  mainTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900',
    fontSize: 40,
    color: '#FFFFFF',
    letterSpacing: -1,
  },
  subTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 16,
    color: '#94a3b8',
    marginTop: 8,
    lineHeight: 24,
  },
  formContainer: {
    gap: 32,
  },
  inputGroup: {
    gap: 8,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  label: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 14,
    color: '#f8fafc',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  badge: {
    backgroundColor: 'rgba(255,252,0,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,252,0,0.3)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 10,
    color: '#FFFC00',
  },
  helperText: {
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 13,
    color: '#64748b',
    marginBottom: 4,
  },
  inputWrapper: {
    width: '100%',
    height: 64,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 16,
    overflow: 'hidden',
  },
  input: {
    flex: 1,
    paddingHorizontal: 20,
    color: '#FFFFFF',
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '600',
    fontSize: 16,
  },
  picker: {
    width: '100%',
    height: '100%',
    color: '#FFFFFF',
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    paddingHorizontal: 24,
    paddingTop: 24,
    backgroundColor: '#0f172a',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },
  saveBtn: {
    width: '100%',
    height: 64,
    borderRadius: 32,
    shadowColor: '#FFFC00',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  saveGradient: {
    width: '100%',
    height: '100%',
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveBtnText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 18,
    color: '#000000',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: '#1e293b',
    borderRadius: 24,
    width: '100%',
    paddingBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  modalHeader: {
    padding: 24,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
    marginBottom: 8,
  },
  modalTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 20,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  modalScroll: {
    paddingHorizontal: 16,
  },
  modalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  modalItemText: {
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 16,
    color: '#f8fafc',
  },
});
