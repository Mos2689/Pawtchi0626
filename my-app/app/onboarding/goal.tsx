import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors } from '../../constants/Theme';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../providers/AuthProvider';
import { usePetStore } from '../../store/usePetStore';
import { useActivePetStore } from '../../store/useActivePetStore';
import Slider from '@react-native-community/slider';

import { calculateDailyKcal, deriveGoal } from '../../lib/healthMath';
import { getBreedDefaults } from '../../lib/breedData';
import { deriveLifeStage, getLifeStageCalorieMultiplier, getLifeStageLabel } from '../../lib/lifeStage';

const BCS_OPTIONS = [
  { label: 'A bit thin', bcs: 3, icon: 'remove' as const },
  { label: 'Just right', bcs: 5, icon: 'check-circle' as const },
  { label: 'A bit chunky', bcs: 7, icon: 'circle' as const },
  { label: 'Overweight', bcs: 9, icon: 'expand' as const },
];

// Screen 4: Set Goal
export default function GoalScreen() {
  const router = useRouter();
  const theme = Colors.light;
  const insets = useSafeAreaInsets();

  const { user } = useAuth();
  const petData = usePetStore();
  const [loading, setLoading] = useState(false);

  // Start Target weight at current weight, or default to 18.5
  const currentWeight = parseFloat(petData.weight) || 18.5;
  const [targetWeight, setTargetWeight] = useState(currentWeight);
  const [idealExplanation, setIdealExplanation] = useState('');
  const [estimating, setEstimating] = useState(true);

  // Life stage computation
  const breedDefaults = getBreedDefaults(petData.species, petData.breed);
  const ageYearsNum = parseInt(petData.ageYears) || 0;
  const ageMonthsNum = parseInt(petData.ageMonths) || 0;
  const speciesVal = (petData.species === 'cat') ? 'cat' as const : 'dog' as const;
  const lifeStage = deriveLifeStage(speciesVal, ageYearsNum, ageMonthsNum, breedDefaults?.sizeCategory);
  const lifeStageLabel = getLifeStageLabel(lifeStage, speciesVal);
  const lifeStageMultiplier = getLifeStageCalorieMultiplier(lifeStage);

  // Destructure for stable dependency array
  const { species, breed, ageYears, weight, gender, ageMonths } = petData;

  React.useEffect(() => {
    async function fetchIdealWeight() {
      // Small artificial delay to ensure smooth transition
      const timer = new Promise(resolve => setTimeout(resolve, 800));

      const req = supabase.functions.invoke('estimate-weight', {
        body: {
          species,
          breed,
          age_years: parseInt(ageYears) || null,
          age_months: parseInt(ageMonths) || null,
          current_weight_kg: parseFloat(weight) || 10,
          gender: gender,
        }
      });

      const response = await Promise.all([timer, req]);
      const data = response[1].data;
      const error = response[1].error;

      if (data && data.ideal_weight_kg) {
        let idealWeight = data.ideal_weight_kg;
        // Nudge based on BCS if set
        if (petData.bodyConditionScore) {
          if (petData.bodyConditionScore >= 7) {
            idealWeight = Math.min(idealWeight, currentWeight * 0.92);
          } else if (petData.bodyConditionScore <= 3) {
            idealWeight = Math.max(idealWeight, currentWeight * 1.08);
          }
        }
        setTargetWeight(Math.round(idealWeight * 2) / 2); // Round to 0.5
        if (data.explanation) setIdealExplanation(data.explanation);
      } else {
        console.warn("Failed to fetch ideal weight", error);
      }
      setEstimating(false);
    }

    fetchIdealWeight();
  }, [species, breed, ageYears, ageMonths, weight, gender, currentWeight, petData.bodyConditionScore]);

  const handleComplete = async () => {
    if (!user) {
      Alert.alert('Error', 'No authenticated user found.');
      return;
    }

    setLoading(true);

    // Calculate baseline calories
    const weightVal = parseFloat(petData.weight) || 10;
    const totalAgeMonths = ageYearsNum * 12 + ageMonthsNum;

    const dailyKcal = calculateDailyKcal(
      weightVal,
      speciesVal,
      petData.isNeutered,
      petData.activityLevel || 'normal',
      deriveGoal(weightVal, targetWeight),
      totalAgeMonths || undefined,
      lifeStageMultiplier,
    );

    let publicAvatarUrl = null;
    if (petData.imageUri) {
      try {
        const ext = petData.imageUri.substring(petData.imageUri.lastIndexOf('.') + 1) || 'jpg';
        const fileName = `${user.id}_${Date.now()}.${ext}`;

        const formData = new FormData();
        formData.append('file', {
          uri: petData.imageUri,
          name: fileName,
          type: `image/${ext === 'jpg' ? 'jpeg' : ext}`
        } as any);

        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(fileName, formData);

        if (!uploadError && uploadData) {
          const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(fileName);
          publicAvatarUrl = urlData.publicUrl;
        }
      } catch (err) {
        console.error("Avatar upload failed:", err);
      }
    }

    // Store age as decimal (years + months/12)
    const decimalAge = ageYearsNum + ageMonthsNum / 12;

    const { error } = await supabase.from('pets').insert({
      owner_id: user.id,
      name: petData.name || 'My Pet',
      species: speciesVal,
      breed: petData.breed || null,
      gender: petData.gender,
      current_weight_kg: weightVal,
      target_weight_kg: targetWeight,
      age_years: decimalAge || null,
      is_neutered: petData.isNeutered,
      activity_level: petData.activityLevel || 'normal',
      target_daily_calories: dailyKcal,
      allergies: petData.allergies.length > 0 ? petData.allergies : null,
      body_condition_score: petData.bodyConditionScore,
      image_url: publicAvatarUrl || 'https://images.unsplash.com/photo-1583337130417-3346a1be7dee?q=80&w=1000&auto=format&fit=crop',
    });

    setLoading(false);

    if (error) {
      Alert.alert('Error creating profile', error.message);
    } else {
      // Await fetching the newly created pet to hydrate the store
      await useActivePetStore.getState().fetchPet(user.id);

      petData.resetForm();
      router.replace('/(tabs)');
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: '#FFFFFF' }]}>
      {/* Top Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={24} color={theme['on-surface']} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme['on-surface'] }]}>Pet Journey</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* Progress Indicator */}
        <View style={styles.progressSection}>
          <View style={styles.progressBars}>
            <View style={[styles.progressPill, { backgroundColor: '#E6E300', width: 32 }]} />
            <View style={[styles.progressPill, { backgroundColor: '#E6E300', width: 32 }]} />
            <View style={[styles.progressPill, { backgroundColor: '#E6E300', width: 32 }]} />
            <View style={[styles.progressPill, { backgroundColor: '#E5E7EB', width: 48 }]} />
          </View>
          <Text style={[styles.stepText, { color: theme['on-surface-variant'] }]}>STEP 4 OF 4</Text>
        </View>

        {/* Hero Section */}
        <View style={styles.heroSection}>
          <Text style={[styles.mainHeading, { color: theme['on-surface'] }]}>
            Set a Health Goal.
          </Text>

          {/* Life Stage Badge */}
          {petData.breed && petData.breed !== 'Mixed Breed' && petData.breed !== 'Other' ? (
            <View style={styles.lifeStageBadge}>
              <MaterialIcons name="auto-awesome" size={14} color="#92400e" />
              <Text style={styles.lifeStageBadgeText}>
                {petData.name || 'Your pet'} is a {lifeStageLabel} {petData.breed}
              </Text>
            </View>
          ) : (
            <View style={styles.lifeStageBadge}>
              <MaterialIcons name="auto-awesome" size={14} color="#92400e" />
              <Text style={styles.lifeStageBadgeText}>
                {petData.name || 'Your pet'} is a {lifeStageLabel} {speciesVal === 'cat' ? 'Cat' : 'Dog'}
              </Text>
            </View>
          )}

          {/* Asymmetric Avatar */}
          <View style={styles.avatarContainer}>
            <View style={[styles.blurBlob, { backgroundColor: 'rgba(255,252,0,0.2)' }]} />
            <View style={styles.avatarInner}>
              <Image
                source={{ uri: petData.imageUri || 'https://images.unsplash.com/photo-1583337130417-3346a1be7dee?q=80&w=1000' }}
                style={styles.avatarImg}
              />
              <View style={[styles.floatingReward, { backgroundColor: '#ffc4b3' }]}>
                <MaterialIcons name="auto-awesome" size={14} color="#862400" />
                <Text style={[styles.rewardText, { color: '#862400' }]}>PEAK HEALTH</Text>
              </View>
            </View>
            <View style={[styles.overlapBadge, { backgroundColor: '#FFFC00', borderColor: '#FFFFFF' }]}>
              <MaterialIcons name="fitness-center" size={32} color="#243036" />
            </View>
          </View>
        </View>

        {/* Body Condition Selector */}
        <View style={styles.bcsSection}>
          <Text style={[styles.bcsLabel, { color: theme['on-surface-variant'] }]}>
            How would you describe {petData.name || 'your pet'}'s body shape?
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bcsRow}>
            {BCS_OPTIONS.map((opt) => {
              const isSelected = petData.bodyConditionScore === opt.bcs;
              return (
                <TouchableOpacity
                  key={opt.bcs}
                  style={[
                    styles.bcsCard,
                    isSelected
                      ? { backgroundColor: '#FFFFFF', borderColor: '#FFFC00', borderWidth: 3 }
                      : { backgroundColor: '#F8F9FA', borderColor: 'rgba(209,213,225,0.3)', borderWidth: 1 }
                  ]}
                  onPress={() => petData.setBodyConditionScore(opt.bcs)}
                  activeOpacity={0.8}
                >
                  <MaterialIcons
                    name={opt.icon}
                    size={24}
                    color={isSelected ? '#243036' : '#94a3b8'}
                  />
                  <Text style={[
                    styles.bcsCardText,
                    { color: isSelected ? '#243036' : '#64748b' }
                  ]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Target Weight Controls */}
        <View style={[styles.controlsCard, { backgroundColor: '#F8F9FA', borderColor: '#E5E7EB' }]}>
          <View style={styles.weightHeader}>
            <Text style={[styles.weightLabel, { color: theme['on-surface-variant'] }]}>TARGET WEIGHT</Text>
            <View style={styles.weightValueRow}>
              {estimating ? (
                <ActivityIndicator size="small" color="#FFFC00" style={{ transform: [{ scale: 1.5 }], marginVertical: 12 }} />
              ) : (
                <Text style={[styles.weightValue, { color: theme['on-surface'] }]}>{targetWeight.toFixed(1)}</Text>
              )}
              <Text style={[styles.weightUnit, { color: theme['on-surface-variant'] }]}>kg</Text>
            </View>

            {idealExplanation ? (
              <View style={[styles.idealBadge, { backgroundColor: 'rgba(255,252,0,0.2)' }]}>
                <Text style={[styles.idealBadgeText, { color: theme['on-surface'] }]}>{idealExplanation}</Text>
              </View>
            ) : (
              <View style={[styles.idealBadge, { backgroundColor: 'transparent' }]}>
                <Text style={[styles.idealBadgeText, { color: theme['on-surface-variant'] }]}>Slide to manually define goal</Text>
              </View>
            )}
          </View>

          {/* Functional React Native Slider */}
          <View style={styles.sliderContainer}>
             <Slider
               style={{ width: '100%', height: 40 }}
               minimumValue={Math.max(1, currentWeight - 10)}
               maximumValue={currentWeight + 10}
               step={0.5}
               value={targetWeight}
               onValueChange={setTargetWeight}
               minimumTrackTintColor="#FFFC00"
               maximumTrackTintColor="#E5E7EB"
               thumbTintColor="#243036"
             />
             <View style={styles.sliderMarkers}>
               <Text style={styles.markerText}>{Math.max(1, currentWeight - 10)} kg</Text>
               <Text style={styles.markerText}>{(currentWeight).toFixed(1)} kg</Text>
               <Text style={styles.markerText}>{currentWeight + 10} kg</Text>
             </View>
          </View>

          {/* Bento Stats Grid */}
          <View style={styles.bentoGrid}>
            <View style={[styles.bentoCard, { borderColor: 'rgba(229,231,235,0.5)' }]}>
              <Text style={[styles.bentoLabel, { color: theme['on-surface-variant'] }]}>CURRENT</Text>
              <Text style={[styles.bentoValue, { color: theme['on-surface'] }]}>{currentWeight.toFixed(1)}<Text style={{ fontSize: 14 }}>kg</Text></Text>
            </View>
            <View style={[styles.bentoCard, { borderColor: 'rgba(229,231,235,0.5)' }]}>
              <Text style={[styles.bentoLabel, { color: theme['on-surface-variant'] }]}>DIFFERENCE</Text>
              <Text style={[styles.bentoValue, { color: (targetWeight - currentWeight) < 0 ? '#a83206' : (targetWeight - currentWeight) > 0 ? '#0ea5e9' : '#10b981' }]}>
                {targetWeight - currentWeight > 0 ? '+' : ''}{(targetWeight - currentWeight).toFixed(1)}<Text style={{ fontSize: 14 }}>kg</Text>
              </Text>
            </View>
          </View>

        </View>

        {/* Final Confirmation Area */}
        <View style={styles.confirmationArea}>
          <TouchableOpacity
            style={[styles.completeBtn, { backgroundColor: '#FFFC00', opacity: loading ? 0.7 : 1 }]}
            onPress={handleComplete}
            activeOpacity={0.9}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#243036" />
            ) : (
              <>
                <Text style={[styles.completeBtnText, { color: '#243036' }]}>Complete Profile</Text>
                <MaterialIcons name="check-circle" size={24} color="#243036" />
              </>
            )}
          </TouchableOpacity>

          <Text style={[styles.disclaimer, { color: theme['on-surface-variant'] }]}>
            By completing your profile, you agree to our <Text style={[styles.link, { color: theme['on-surface'], textDecorationColor: '#FFFC00' }]}>Health Guidelines</Text> and <Text style={[styles.link, { color: theme['on-surface'], textDecorationColor: '#FFFC00' }]}>Privacy Policy</Text>.
          </Text>
        </View>

      </ScrollView>

      {/* Fade out bottom anchor */}
      <View style={styles.bottomFade} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    zIndex: 50,
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  headerTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 20,
    letterSpacing: -0.5,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 48,
  },
  progressSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 40,
  },
  progressBars: {
    flexDirection: 'row',
    gap: 8,
  },
  progressPill: {
    height: 6,
    borderRadius: 3,
  },
  stepText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 14,
    letterSpacing: 1.5,
  },
  heroSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  mainHeading: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 32,
    lineHeight: 36,
    letterSpacing: -1,
    marginBottom: 12,
    textAlign: 'center',
  },
  lifeStageBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fef3c7',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 24,
  },
  lifeStageBadgeText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 13,
    color: '#92400e',
  },
  avatarContainer: {
    width: 256,
    height: 256,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blurBlob: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    borderRadius: 128,
  },
  avatarInner: {
    width: '100%',
    height: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 24 },
    shadowOpacity: 0.06,
    shadowRadius: 48,
    elevation: 10,
  },
  avatarImg: {
    width: '100%',
    height: '100%',
  },
  floatingReward: {
    position: 'absolute',
    top: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  rewardText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: -0.5,
  },
  overlapBadge: {
    position: 'absolute',
    bottom: -16,
    left: -16,
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 8,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  bcsSection: {
    marginBottom: 24,
    gap: 12,
  },
  bcsLabel: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 15,
    textAlign: 'center',
  },
  bcsRow: {
    gap: 10,
    paddingHorizontal: 4,
  },
  bcsCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    gap: 6,
    minWidth: 100,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  bcsCardText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 12,
    textAlign: 'center',
  },
  controlsCard: {
    padding: 32,
    borderRadius: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  weightHeader: {
    alignItems: 'center',
    gap: 4,
  },
  weightLabel: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 14,
    letterSpacing: 1.5,
  },
  weightValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  weightValue: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 64,
    letterSpacing: -2,
  },
  weightUnit: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 20,
  },
  idealBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 16,
    marginTop: 4,
  },
  idealBadgeText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 12,
  },
  sliderContainer: {
    paddingVertical: 16,
    marginTop: 24,
    marginBottom: 16,
  },
  sliderMarkers: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 48,
    paddingHorizontal: 4,
  },
  markerText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 12,
    color: '#515d64',
  },
  bentoGrid: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 24,
  },
  bentoCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    padding: 20,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  bentoLabel: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: -0.5,
  },
  bentoValue: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 24,
  },
  confirmationArea: {
    marginTop: 48,
    gap: 16,
  },
  completeBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 24,
    borderRadius: 40,
    gap: 12,
    shadowColor: '#FFFC00',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 8,
  },
  completeBtnText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 20,
  },
  disclaimer: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '500',
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 32,
    lineHeight: 20,
  },
  link: {
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  bottomFade: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    height: 32,
    backgroundColor: 'rgba(255,255,255,0.8)',
  }
});
