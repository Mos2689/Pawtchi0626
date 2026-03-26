import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors } from '../../constants/Theme';
import { usePetStore } from '../../store/usePetStore';

// Screen 1: Select Species
export default function SpeciesScreen() {
  const router = useRouter();
  const theme = Colors.light;
  const insets = useSafeAreaInsets();
  
  const { species, setSpecies } = usePetStore();

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
          <View style={styles.progressTextRow}>
            <Text style={[styles.stepText, { color: theme['on-surface-variant'] }]}>STEP 2 OF 4</Text>
            <Text style={[styles.stepTitle, { color: theme['on-surface'] }]}>SPECIES</Text>
          </View>
          <View style={[styles.progressBarBg, { backgroundColor: '#F1F3F5' }]}>
            <View style={[styles.progressBarFill, { backgroundColor: '#FFFC00', width: '50%' }]} />
          </View>
        </View>

        {/* Headline */}
        <View style={styles.headlineSection}>
          <Text style={[styles.mainHeading, { color: theme['on-surface'] }]}>
            Who are we caring for today?
          </Text>
          <Text style={[styles.subHeading, { color: theme['on-surface-variant'] }]}>
            Choose your companion to help us tailor their health journey.
          </Text>
        </View>

        {/* Selection Cards */}
        <View style={styles.cardsContainer}>
          {/* Dog Card */}
          <TouchableOpacity 
            style={[
              styles.card, 
              species === 'dog' ? styles.cardSelected : { backgroundColor: '#F8F9FA', borderColor: '#DEE2E6' }
            ]}
            onPress={() => setSpecies('dog')}
            activeOpacity={0.9}
          >
            <View>
              <Text style={[styles.cardTitle, { color: theme['on-surface'] }]}>Dog</Text>
              <Text style={[styles.cardSubtitle, { color: theme['on-surface-variant'] }]}>Canine friend</Text>
            </View>
            <View>
              <MaterialIcons name="pets" size={80} color={species === 'dog' ? theme['on-surface'] : '#CED4DA'} />
            </View>
            {species === 'dog' && (
              <View style={[styles.checkBadge, { backgroundColor: '#FFFC00', borderColor: '#FFF' }]}>
                <MaterialIcons name="check" size={14} color="#000" />
              </View>
            )}
          </TouchableOpacity>

          {/* Cat Card */}
          <TouchableOpacity 
            style={[
              styles.card, 
              species === 'cat' ? styles.cardSelected : { backgroundColor: '#F8F9FA', borderColor: '#DEE2E6' }
            ]}
            onPress={() => setSpecies('cat')}
            activeOpacity={0.9}
          >
            <View>
              <Text style={[styles.cardTitle, { color: theme['on-surface'] }]}>Cat</Text>
              <Text style={[styles.cardSubtitle, { color: theme['on-surface-variant'] }]}>Feline friend</Text>
            </View>
            <View>
              <MaterialIcons name="pets" size={80} color={species === 'cat' ? theme['on-surface'] : '#CED4DA'} />
            </View>
            {species === 'cat' && (
              <View style={[styles.checkBadge, { backgroundColor: '#FFFC00', borderColor: '#FFF' }]}>
                <MaterialIcons name="check" size={14} color="#000" />
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Footer Actions */}
        <View style={styles.footerSection}>
          <TouchableOpacity 
            style={[styles.continueBtn, { backgroundColor: '#FFFC00' }]}
            onPress={() => router.push('/onboarding/vitals')}
            activeOpacity={0.9}
          >
            <Text style={[styles.continueText, { color: '#000000' }]}>Continue</Text>
            <MaterialIcons name="arrow-forward" size={24} color="#000000" />
          </TouchableOpacity>
          <Text style={[styles.footerNote, { color: theme['on-surface-variant'] }]}>
            Don't worry, you can add more pets later in your profile settings.
          </Text>
        </View>

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
  progressSection: {
    marginBottom: 40,
  },
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
  headlineSection: {
    marginBottom: 40,
  },
  mainHeading: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 36,
    lineHeight: 40,
    letterSpacing: -1,
    marginBottom: 16,
  },
  subHeading: {
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 18,
    lineHeight: 28,
  },
  cardsContainer: {
    gap: 24,
    marginBottom: 48,
  },
  card: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 32,
    borderRadius: 24,
    borderWidth: 1,
  },
  cardSelected: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFC00',
    borderWidth: 4,
    padding: 29, // Account for borderWidth difference
    shadowColor: '#FFFC00',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 8,
  },
  cardTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 48,
    lineHeight: 52,
    marginBottom: 4,
  },
  cardSubtitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '500',
    fontSize: 16,
  },
  checkBadge: {
    position: 'absolute',
    top: 16,
    right: 16,
    padding: 4,
    borderRadius: 16,
    borderWidth: 2,
  },
  footerSection: {
    marginTop: 'auto',
  },
  continueBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 20,
    borderRadius: 40,
    shadowColor: '#FFFC00',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 8,
    gap: 12,
  },
  continueText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 18,
  },
  footerNote: {
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 24,
    paddingHorizontal: 32,
  }
});
