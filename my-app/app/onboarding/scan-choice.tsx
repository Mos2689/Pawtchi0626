import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors } from '../../constants/Theme';
import * as ImagePicker from 'expo-image-picker';
import { usePetStore } from '../../store/usePetStore';
import { supabase } from '../../lib/supabase';

export default function ScanChoiceScreen() {
  const router = useRouter();
  const theme = Colors.light;
  const insets = useSafeAreaInsets();
  const [scanning, setScanning] = useState(false);

  const {
    species,
    setName, setBreed, setGender, setIsNeutered,
    setWeight, setAgeYears, setAgeMonths,
    setAllergies, setBodyConditionScore,
  } = usePetStore();

  const pickImage = async (source: 'camera' | 'gallery') => {
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      quality: 0.8,
      base64: true,
    };

    let result: ImagePicker.ImagePickerResult;
    if (source === 'camera') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Camera access is required to scan your vet report.');
        return null;
      }
      result = await ImagePicker.launchCameraAsync(options);
    } else {
      result = await ImagePicker.launchImageLibraryAsync(options);
    }

    if (result.canceled || !result.assets?.[0]?.base64) return null;
    return result.assets[0];
  };

  const handleScan = async (source: 'camera' | 'gallery') => {
    const asset = await pickImage(source);
    if (!asset) return;

    setScanning(true);

    try {
      const base64 = asset.base64!;
      const mimeType = asset.uri.endsWith('.png') ? 'image/png' : 'image/jpeg';

      const { data, error } = await supabase.functions.invoke('parse-onboarding-report', {
        body: { imageBase64: base64, mimeType, species: species || 'dog' },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to parse report');

      const extracted = data.data;

      // Hydrate the store with extracted data
      if (extracted.name) setName(extracted.name);
      if (extracted.breed) setBreed(extracted.breed);
      if (extracted.gender) setGender(extracted.gender);
      if (extracted.is_neutered !== null && extracted.is_neutered !== undefined) {
        setIsNeutered(extracted.is_neutered);
      }
      if (extracted.weight_kg) setWeight(String(Math.round(extracted.weight_kg * 10) / 10));
      if (extracted.age_years !== null && extracted.age_years !== undefined) {
        setAgeYears(String(extracted.age_years));
      }
      if (extracted.age_months !== null && extracted.age_months !== undefined) {
        setAgeMonths(String(extracted.age_months));
      }
      if (extracted.allergies && extracted.allergies.length > 0) {
        setAllergies(extracted.allergies);
      }
      if (extracted.body_condition_score) {
        setBodyConditionScore(extracted.body_condition_score);
      }

      setScanning(false);

      // Count how many fields were filled
      const filled = [
        extracted.name, extracted.breed, extracted.gender,
        extracted.weight_kg, extracted.age_years,
      ].filter(Boolean).length;

      if (filled >= 2) {
        Alert.alert(
          'Report scanned!',
          `We found ${filled} details from your vet report. Review and adjust on the next screens.`,
          [{ text: 'Continue', onPress: () => router.push('/onboarding/vitals') }],
        );
      } else {
        Alert.alert(
          "Couldn't read much",
          "We couldn't extract enough details from that image. You can try again or enter details manually.",
          [
            { text: 'Try Again', style: 'cancel' },
            { text: 'Enter Manually', onPress: () => router.push('/onboarding/vitals') },
          ],
        );
      }
    } catch (err: any) {
      setScanning(false);
      Alert.alert(
        "Couldn't read that",
        'We had trouble reading your vet report. You can try a clearer photo or enter details manually.',
        [
          { text: 'Try Again', style: 'cancel' },
          { text: 'Enter Manually', onPress: () => router.push('/onboarding/vitals') },
        ],
      );
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: '#FFFFFF' }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={24} color={theme['on-surface']} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme['on-surface'] }]}>Pet Journey</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Progress */}
        <View style={styles.progressSection}>
          <View style={styles.progressTextRow}>
            <Text style={[styles.stepText, { color: theme['on-surface-variant'] }]}>STEP 2 OF 6</Text>
            <Text style={[styles.stepTitle, { color: theme['on-surface'] }]}>QUICK START</Text>
          </View>
          <View style={[styles.progressBarBg, { backgroundColor: '#F1F3F5' }]}>
            <View style={[styles.progressBarFill, { backgroundColor: '#FFFC00', width: '33%' }]} />
          </View>
        </View>

        {/* Headline */}
        <View style={styles.headlineSection}>
          <Text style={[styles.mainHeading, { color: theme['on-surface'] }]}>
            Got a vet report handy?
          </Text>
          <Text style={[styles.subHeading, { color: theme['on-surface-variant'] }]}>
            Snap a photo and we'll fill in your pet's details automatically. Or skip and enter them yourself.
          </Text>
        </View>

        {scanning ? (
          <View style={styles.scanningContainer}>
            <ActivityIndicator size="large" color="#FFFC00" />
            <Text style={[styles.scanningText, { color: theme['on-surface'] }]}>
              Reading your vet report...
            </Text>
            <Text style={[styles.scanningSubtext, { color: theme['on-surface-variant'] }]}>
              This usually takes a few seconds
            </Text>
          </View>
        ) : (
          <>
            {/* Scan Cards */}
            <View style={styles.cardsContainer}>
              {/* Camera Card */}
              <TouchableOpacity
                style={[styles.card, { backgroundColor: '#FFFFFF', borderColor: '#FFFC00', borderWidth: 3 }]}
                onPress={() => handleScan('camera')}
                activeOpacity={0.9}
              >
                <View style={styles.cardContent}>
                  <View style={[styles.iconCircle, { backgroundColor: '#FFFDE0' }]}>
                    <MaterialIcons name="photo-camera" size={32} color="#000" />
                  </View>
                  <Text style={[styles.cardTitle, { color: theme['on-surface'] }]}>Take a Photo</Text>
                  <Text style={[styles.cardSubtitle, { color: theme['on-surface-variant'] }]}>
                    Point your camera at the report
                  </Text>
                </View>
              </TouchableOpacity>

              {/* Gallery Card */}
              <TouchableOpacity
                style={[styles.card, { backgroundColor: '#F8F9FA', borderColor: '#DEE2E6' }]}
                onPress={() => handleScan('gallery')}
                activeOpacity={0.9}
              >
                <View style={styles.cardContent}>
                  <View style={[styles.iconCircle, { backgroundColor: '#F1F3F5' }]}>
                    <MaterialIcons name="photo-library" size={32} color="#495057" />
                  </View>
                  <Text style={[styles.cardTitle, { color: theme['on-surface'] }]}>From Gallery</Text>
                  <Text style={[styles.cardSubtitle, { color: theme['on-surface-variant'] }]}>
                    Pick a saved photo of the report
                  </Text>
                </View>
              </TouchableOpacity>
            </View>

            {/* Tips */}
            <View style={[styles.tipsCard, { backgroundColor: '#F8F9FA' }]}>
              <Text style={[styles.tipsTitle, { color: theme['on-surface'] }]}>Tips for best results</Text>
              <View style={styles.tipRow}>
                <MaterialIcons name="check-circle" size={16} color="#868E96" />
                <Text style={[styles.tipText, { color: theme['on-surface-variant'] }]}>Use a well-lit, flat surface</Text>
              </View>
              <View style={styles.tipRow}>
                <MaterialIcons name="check-circle" size={16} color="#868E96" />
                <Text style={[styles.tipText, { color: theme['on-surface-variant'] }]}>Include the header with pet name & details</Text>
              </View>
              <View style={styles.tipRow}>
                <MaterialIcons name="check-circle" size={16} color="#868E96" />
                <Text style={[styles.tipText, { color: theme['on-surface-variant'] }]}>Vet reports, vaccination cards, or discharge notes all work</Text>
              </View>
            </View>

            {/* Manual Entry */}
            <View style={styles.footerSection}>
              <TouchableOpacity
                style={styles.skipBtn}
                onPress={() => router.push('/onboarding/vitals')}
                activeOpacity={0.7}
              >
                <Text style={[styles.skipText, { color: theme['on-surface-variant'] }]}>
                  I don't have a report — enter details manually
                </Text>
                <MaterialIcons name="arrow-forward" size={18} color={theme['on-surface-variant']} />
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
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
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(238,238,238,0.5)',
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
    paddingTop: 32,
    paddingBottom: 48,
  },
  progressSection: { marginBottom: 40 },
  progressTextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  stepText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 14,
    letterSpacing: 1.5,
  },
  stepTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 14,
  },
  progressBarBg: {
    height: 12,
    borderRadius: 6,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 6,
  },
  headlineSection: { marginBottom: 40 },
  mainHeading: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -1,
    marginBottom: 16,
  },
  subHeading: {
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 17,
    lineHeight: 26,
  },
  cardsContainer: {
    gap: 16,
    marginBottom: 32,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
  },
  cardContent: {
    alignItems: 'center',
    gap: 12,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 20,
  },
  cardSubtitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '500',
    fontSize: 15,
    textAlign: 'center',
  },
  tipsCard: {
    borderRadius: 16,
    padding: 20,
    marginBottom: 32,
    gap: 10,
  },
  tipsTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 15,
    marginBottom: 4,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  tipText: {
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 14,
    lineHeight: 20,
    flex: 1,
  },
  scanningContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 80,
    gap: 16,
  },
  scanningText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 20,
    marginTop: 8,
  },
  scanningSubtext: {
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 15,
  },
  footerSection: {
    marginTop: 'auto',
  },
  skipBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  skipText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '600',
    fontSize: 16,
  },
});
