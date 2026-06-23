import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors } from '../../constants/Theme';
import { color } from '../../constants/design';
import { usePetStore } from '../../store/usePetStore';
import { PawtchiButton } from '../../components/PawtchiButton';
import { OnboardingHeader } from '../../components/OnboardingHeader';
import { stepIndex, trackStepCompleted, useOnboardingStepTracking } from '../../lib/onboardingFunnel';

// Step 1 of 6 — choose species
export default function SpeciesScreen() {
  const router = useRouter();
  const theme = Colors.light;
  useOnboardingStepTracking('species');

  const { species, setSpecies } = usePetStore();

  return (
    <View style={[styles.container, { backgroundColor: '#FFFFFF' }]}>
      <OnboardingHeader step={stepIndex('species')} stepId="species" showBack={false} />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

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
              <View style={[styles.checkBadge, { backgroundColor: '#F7F602', borderColor: '#FFF' }]}>
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
              <View style={[styles.checkBadge, { backgroundColor: '#F7F602', borderColor: '#FFF' }]}>
                <MaterialIcons name="check" size={14} color="#000" />
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Footer Actions */}
        <View style={styles.footerSection}>
          <PawtchiButton
            title="Continue"
            variant="primary"
            iconName="arrow-forward"
            iconPosition="right"
            onPress={() => {
              trackStepCompleted('species', { species: species || 'unset' });
              router.push('/onboarding/identity' as any);
            }}
          />
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
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 48,
  },
  headlineSection: {
    marginBottom: 40,
  },
  mainHeading: {
    fontFamily: 'Montserrat_800ExtraBold',
    fontSize: 36,
    lineHeight: 40,
    letterSpacing: -1,
    marginBottom: 16,
  },
  subHeading: {
    fontFamily: 'Montserrat_400Regular',
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
    borderColor: color.yellow,
    borderWidth: 3,
    padding: 30, // Account for borderWidth difference
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 6,
  },
  cardTitle: {
    fontFamily: 'Montserrat_800ExtraBold',
    fontSize: 48,
    lineHeight: 52,
    marginBottom: 4,
  },
  cardSubtitle: {
    fontFamily: 'Montserrat_500Medium',
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
    shadowColor: '#F7F602',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 8,
    gap: 12,
  },
  continueText: {
    fontFamily: 'Montserrat_800ExtraBold',
    fontSize: 18,
  },
  footerNote: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 24,
    paddingHorizontal: 32,
  }
});
