import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Once the preview has been seen, it never resurfaces (one-time view).
export const PREVIEW_SEEN_KEY = 'preview_home_seen';

import { useActivePetStore } from '../store/useActivePetStore';
import { useSubscription } from '../hooks/useSubscription';
import { HealthRings, ProgressBar } from '../components/HealthRings';
import { deriveLifeStage, getLifeStageLabel } from '../lib/lifeStage';
import { track } from '../lib/analytics';

const FALLBACK_PHOTO = 'https://images.unsplash.com/photo-1583337130417-3346a1be7dee?q=80&w=1000&auto=format&fit=crop';

// A faded "Sample" tag so nothing here is mistaken for real, logged data (brand: proof over claim).
function SampleTag() {
  return (
    <View style={styles.sampleTag}>
      <Text style={styles.sampleTagText}>SAMPLE</Text>
    </View>
  );
}

export default function PreviewHomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { activePet } = useActivePetStore();
  const { isPro } = useSubscription();

  const petName = activePet?.name?.trim() || 'your pet';
  const photo = activePet?.image_url || FALLBACK_PHOTO;
  const species = activePet?.species === 'cat' ? 'cat' : 'dog';
  const breed = activePet?.breed;
  const ageYears = Math.floor(activePet?.age_years || 0);
  const lifeStage = getLifeStageLabel(deriveLifeStage(species, ageYears, 0), species);

  // Real targets computed during onboarding — gives the preview honest, personal anchors.
  const targetCal = activePet?.target_daily_calories || 0;
  const currentWeight = activePet?.current_weight_kg || 0;
  const targetWeight = activePet?.target_weight_kg || currentWeight;
  const waterTarget = currentWeight ? Math.round(currentWeight * 50) : 0;
  const waterDisplay = waterTarget >= 1000 ? `${(waterTarget / 1000).toFixed(1)}L` : `${waterTarget}ml`;

  // Aspirational "good day" sample fills.
  const sampleCalories = targetCal ? Math.round(targetCal * 0.96) : 0;

  useEffect(() => {
    track('preview_home_viewed', {});
    // Mark as seen so it never resurfaces on the home again.
    AsyncStorage.setItem(PREVIEW_SEEN_KEY, 'true').catch(() => {});
  }, []);

  const handleStart = () => {
    track('preview_home_cta', { pet: petName });
    router.replace('/(tabs)');
    // Already-subscribed users land straight on home; only prompt non-subscribers.
    if (!isPro) {
      setTimeout(() => router.push('/paywall' as any), 120);
    }
  };

  const sampleMeals = [
    { name: 'Chicken & rice bowl', kcal: Math.round((targetCal || 500) * 0.42), tag: 'Meal' },
    { name: 'Morning kibble', kcal: Math.round((targetCal || 500) * 0.34), tag: 'Meal' },
    { name: 'Dental chew', kcal: Math.round((targetCal || 500) * 0.08), tag: 'Treat' },
  ];

  return (
    <View style={styles.container}>
      {/* Preview banner */}
      <View style={[styles.banner, { paddingTop: insets.top + 12 }]}>
        <View style={styles.bannerLeft}>
          <MaterialIcons name="auto-awesome" size={18} color="#07202A" />
          <Text style={styles.bannerText}>A preview of {petName}&apos;s home as their story builds</Text>
        </View>
        <TouchableOpacity onPress={handleStart} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <MaterialIcons name="close" size={22} color="#07202A" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 120 }]} showsVerticalScrollIndicator={false}>
        {/* Greeting */}
        <Text style={styles.greeting}>
          Evening, <Text style={styles.greetingName}>{petName}</Text>
        </Text>
        <Text style={styles.lifeStage}>
          {breed ? `${lifeStage} ${breed}` : `${lifeStage} ${species === 'cat' ? 'cat' : 'dog'}`}
          {targetWeight ? ` · goal ${targetWeight.toFixed(1)} kg` : ''}
        </Text>

        {/* Rings hero (sample) */}
        <View style={styles.ringsWrapper}>
          <HealthRings calorieProgress={0.96} activityProgress={1} waterProgress={0.88}>
            <View style={styles.petPhoto}>
              <Image source={{ uri: photo }} style={styles.petPhotoImg} contentFit="cover" cachePolicy="memory-disk" transition={200} />
            </View>
            <View style={styles.streakBadge}>
              <MaterialIcons name="local-fire-department" size={12} color="#ea580c" />
              <Text style={styles.streakBadgeText}>14d</Text>
            </View>
          </HealthRings>
          <View style={styles.ringsSampleTag}><SampleTag /></View>
        </View>

        {/* Legend cards (sample) */}
        <View style={styles.legendRow}>
          <View style={styles.legendCard}>
            <View style={styles.legendHeader}>
              <View style={[styles.legendIcon, { backgroundColor: '#f97316' }]}>
                <MaterialIcons name="local-fire-department" size={10} color="#FFFFFF" />
              </View>
              <Text style={styles.legendLabel}>Calories</Text>
            </View>
            <View style={styles.legendValueRow}>
              <Text style={styles.legendValue}>{sampleCalories || 480}</Text>
              <Text style={styles.legendSub}>/ {targetCal || 500} kcal</Text>
            </View>
            <ProgressBar progress={0.96} color="#f97316" />
          </View>
          <View style={styles.legendCard}>
            <View style={styles.legendHeader}>
              <View style={[styles.legendIcon, { backgroundColor: '#F7F602' }]}>
                <MaterialIcons name="directions-walk" size={10} color="#1A1A1A" />
              </View>
              <Text style={styles.legendLabel}>Move</Text>
            </View>
            <View style={styles.legendValueRow}>
              <Text style={styles.legendValue}>45</Text>
              <Text style={styles.legendSub}>/ 45 min</Text>
            </View>
            <ProgressBar progress={1} color="#F7F602" />
          </View>
          <View style={styles.legendCard}>
            <View style={styles.legendHeader}>
              <View style={[styles.legendIcon, { backgroundColor: '#3091F9' }]}>
                <MaterialIcons name="water-drop" size={10} color="#FFFFFF" />
              </View>
              <Text style={styles.legendLabel}>Hydrate</Text>
            </View>
            <View style={styles.legendValueRow}>
              <Text style={styles.legendValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{waterDisplay || '0ml'}</Text>
              <Text style={styles.legendSub} numberOfLines={1}>/ {waterDisplay || '0ml'}</Text>
            </View>
            <ProgressBar progress={0.88} color="#3091F9" />
          </View>
        </View>

        {/* Believer-moment insight (preview) */}
        <View style={styles.insightCard}>
          <LinearGradient colors={['#0f172a', '#1e293b']} style={styles.insightGradient}>
            <View style={styles.insightHeader}>
              <View style={styles.insightIcon}>
                <MaterialIcons name="insights" size={22} color="#F7F602" />
              </View>
              <Text style={styles.insightLabel}>WHAT PAWTCHI WILL NOTICE</Text>
            </View>
            <Text style={styles.insightBody}>
              As {petName}&apos;s history builds, Pawtchi surfaces the slow patterns — like
              &ldquo;{petName}&apos;s walks have been 22% shorter for two weeks. Worth a glance.&rdquo;
            </Text>
          </LinearGradient>
        </View>

        {/* Weight trend (sample) */}
        <View style={styles.trendCard}>
          <View style={styles.trendHeader}>
            <Text style={styles.trendTitle}>Weight trend</Text>
            <SampleTag />
          </View>
          <View style={styles.trendRow}>
            <View>
              <Text style={styles.trendNow}>{currentWeight ? currentWeight.toFixed(1) : '—'} kg</Text>
              <Text style={styles.trendCaption}>now</Text>
            </View>
            <MaterialIcons name="trending-down" size={28} color="#16a34a" />
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[styles.trendNow, { color: '#16a34a' }]}>{targetWeight ? targetWeight.toFixed(1) : '—'} kg</Text>
              <Text style={styles.trendCaption}>goal</Text>
            </View>
          </View>
          <Text style={styles.trendNote}>On track — steady, healthy progress.</Text>
        </View>

        {/* Today's meals (sample) */}
        <View style={styles.mealsHeader}>
          <Text style={styles.mealsTitle}>Today&apos;s Meals</Text>
          <SampleTag />
        </View>
        {sampleMeals.map((m) => (
          <View key={m.name} style={styles.mealCard}>
            <View style={styles.mealImage}>
              <MaterialIcons name={m.tag === 'Treat' ? 'cookie' : 'restaurant'} size={22} color="#9ca3af" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.mealName}>{m.name}</Text>
              <Text style={styles.mealKcal}>{m.kcal} kcal</Text>
            </View>
            <View style={[styles.mealPill, m.tag === 'Treat' && { backgroundColor: '#fff7ed' }]}>
              <Text style={[styles.mealPillText, m.tag === 'Treat' && { color: '#c2410c' }]}>{m.tag}</Text>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Sticky CTA */}
      <View style={[styles.ctaBar, { paddingBottom: insets.bottom + 16 }]}>
        <Text style={styles.ctaHint}>Start logging and this becomes {petName}&apos;s real story.</Text>
        <TouchableOpacity style={styles.cta} onPress={handleStart} activeOpacity={0.9}>
          <Text style={styles.ctaText}>Log {petName}&apos;s first meal</Text>
          <MaterialIcons name="arrow-forward" size={20} color="#07202A" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: '#F7F602',
  },
  bannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  bannerText: { fontFamily: 'Montserrat_700Bold', fontSize: 13, color: '#07202A', flex: 1 },

  scroll: { paddingHorizontal: 20, paddingTop: 20 },
  greeting: { fontFamily: 'Montserrat_800ExtraBold', fontSize: 28, color: '#0f172a', letterSpacing: -0.5 },
  greetingName: { color: '#a16207' },
  lifeStage: { fontFamily: 'Montserrat_600SemiBold', fontSize: 13, color: '#64748b', marginTop: 4, textTransform: 'capitalize' },

  ringsWrapper: { alignItems: 'center', marginVertical: 24, position: 'relative' },
  petPhoto: {
    width: 150, height: 150, borderRadius: 75, overflow: 'hidden',
    borderWidth: 4, borderColor: '#FFFFFF',
  },
  petPhotoImg: { width: '100%', height: '100%' },
  streakBadge: {
    position: 'absolute', bottom: 8, right: '30%',
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#FFFFFF', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3,
  },
  streakBadgeText: { fontFamily: 'Montserrat_800ExtraBold', fontSize: 12, color: '#ea580c' },
  ringsSampleTag: { position: 'absolute', top: 0, right: 8 },

  legendRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  legendCard: {
    flex: 1, backgroundColor: '#FFFFFF', borderRadius: 16, padding: 12,
    borderWidth: 1, borderColor: '#f1f5f9',
  },
  legendHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  legendIcon: { width: 18, height: 18, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  legendLabel: { fontFamily: 'Montserrat_700Bold', fontSize: 11, color: '#64748b' },
  legendValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  legendValue: { fontFamily: 'Montserrat_800ExtraBold', fontSize: 18, color: '#0f172a' },
  legendSub: { fontFamily: 'Montserrat_600SemiBold', fontSize: 10, color: '#94a3b8' },

  insightCard: { borderRadius: 20, overflow: 'hidden', marginBottom: 20 },
  insightGradient: { padding: 18 },
  insightHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  insightIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,252,0,0.1)', alignItems: 'center', justifyContent: 'center' },
  insightLabel: { fontFamily: 'Montserrat_800ExtraBold', fontSize: 11, letterSpacing: 1, color: '#F7F602' },
  insightBody: { fontFamily: 'Montserrat_500Medium', fontSize: 14, lineHeight: 21, color: '#e2e8f0' },

  trendCard: { backgroundColor: '#FFFFFF', borderRadius: 20, borderWidth: 1, borderColor: '#f1f5f9', padding: 18, marginBottom: 20 },
  trendHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  trendTitle: { fontFamily: 'Montserrat_800ExtraBold', fontSize: 16, color: '#0f172a' },
  trendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  trendNow: { fontFamily: 'Montserrat_800ExtraBold', fontSize: 22, color: '#0f172a' },
  trendCaption: { fontFamily: 'Montserrat_600SemiBold', fontSize: 11, color: '#94a3b8' },
  trendNote: { fontFamily: 'Montserrat_600SemiBold', fontSize: 12, color: '#16a34a', marginTop: 12 },

  mealsHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  mealsTitle: { fontFamily: 'Montserrat_800ExtraBold', fontSize: 18, color: '#0f172a' },
  mealCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#f1f5f9',
    padding: 12, marginBottom: 10,
  },
  mealImage: { width: 48, height: 48, borderRadius: 12, backgroundColor: '#f8fafc', alignItems: 'center', justifyContent: 'center' },
  mealName: { fontFamily: 'Montserrat_700Bold', fontSize: 14, color: '#0f172a' },
  mealKcal: { fontFamily: 'Montserrat_600SemiBold', fontSize: 12, color: '#64748b', marginTop: 2 },
  mealPill: { backgroundColor: '#f1f5f9', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  mealPillText: { fontFamily: 'Montserrat_700Bold', fontSize: 11, color: '#475569' },

  sampleTag: { backgroundColor: '#f1f5f9', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  sampleTagText: { fontFamily: 'Montserrat_800ExtraBold', fontSize: 9, letterSpacing: 0.8, color: '#94a3b8' },

  ctaBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderTopWidth: 1, borderTopColor: '#f1f5f9',
    paddingHorizontal: 20, paddingTop: 14,
  },
  ctaHint: { fontFamily: 'Montserrat_500Medium', fontSize: 12, color: '#64748b', textAlign: 'center', marginBottom: 10 },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 58, borderRadius: 16, backgroundColor: '#F7F602',
  },
  ctaText: { fontFamily: 'Montserrat_800ExtraBold', fontSize: 16, color: '#07202A' },
});
