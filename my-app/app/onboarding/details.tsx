import React from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { usePetStore } from '../../store/usePetStore';

// Screen 9: Create Profile Details
export default function DetailsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  
  const petData = usePetStore();

  const pickImage = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      petData.setImageUri(result.assets[0].uri);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: '#FFFFFF' }]}>
      
      {/* Decorative Blobs */}
      <View style={[styles.blobTopRight, { backgroundColor: 'rgba(255,252,0,0.1)' }]} />
      <View style={[styles.blobBottomLeft, { backgroundColor: 'rgba(255,252,0,0.05)' }]} />

      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 32 }]} showsVerticalScrollIndicator={false}>
        
        {/* Progress Steps */}
        <View style={styles.progressRow}>
          <LinearGradient
            colors={['#FFFC00', '#fac129']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.progressActive}
          />
          <View style={[styles.progressInactive, { backgroundColor: '#F0F0F0' }]} />
          <View style={[styles.progressInactive, { backgroundColor: '#F0F0F0' }]} />
        </View>

        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.title, { color: '#2e2f2d' }]}>
            New <Text style={{ color: '#605e00', fontStyle: 'italic' }}>Companion.</Text>
          </Text>
          <Text style={[styles.subtitle, { color: '#5b5c5a' }]}>
            Let&apos;s build a radiant profile for your best friend.
          </Text>
        </View>

        {/* Image Upload Section */}
        <View style={{ alignItems: 'center', marginBottom: 32 }}>
          <TouchableOpacity onPress={pickImage} style={styles.avatarPickerRoot} activeOpacity={0.8}>
            {petData.imageUri ? (
              <Image source={{ uri: petData.imageUri }} style={styles.avatarPickerImage} />
            ) : (
              <View style={styles.avatarPickerPlaceholder}>
                <MaterialIcons name="add-a-photo" size={36} color="#adadab" />
                <Text style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: '700', color: '#adadab', fontSize: 12, marginTop: 8 }}>UPLOAD</Text>
              </View>
            )}
            <View style={styles.avatarPickerBadge}>
              <MaterialIcons name="edit" size={16} color="#000" />
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.formSection}>
          
          {/* Identification */}
          <View style={styles.sectionBlock}>
            <Text style={[styles.sectionLabel, { color: '#767775' }]}>IDENTIFICATION</Text>
            <View style={styles.identRow}>
              <TextInput 
                style={[styles.pillInput, { flex: 1, backgroundColor: '#F9F9F9', borderColor: '#F0F0F0', color: '#2e2f2d' }]}
                placeholder="Pet Name"
                placeholderTextColor="#adadab"
                value={petData.name}
                onChangeText={petData.setName}
              />
              <View style={[styles.pillInput, { flex: 1, backgroundColor: '#F9F9F9', borderColor: '#F0F0F0', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
                <Text style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: '500', color: '#adadab' }}>Select Species</Text>
                <MaterialIcons name="expand-more" size={24} color="#adadab" />
              </View>
            </View>
          </View>

          {/* Species Bento Visual */}
          <View style={styles.speciesBento}>
            <View style={[styles.dogCard, { backgroundColor: '#FFFC00' }]}>
              <MaterialIcons name="pets" size={48} color="#000000" />
              <View>
                <Text style={[styles.bentoTitle, { color: '#000000' }]}>DOG</Text>
                <Text style={[styles.bentoSub, { color: '#000000', opacity: 0.7 }]}>Active & Loyal</Text>
              </View>
              {/* Flare */}
              <View style={[styles.flare, { backgroundColor: 'rgba(255,255,255,0.3)' }]} />
            </View>

            <View style={[styles.catCard, { backgroundColor: '#F9F9F9', borderColor: '#F0F0F0' }]}>
              <MaterialIcons name="pets" size={36} color="#767775" />
              <View>
                <Text style={[styles.catTitle, { color: '#2e2f2d' }]}>CAT</Text>
                <Text style={[styles.catSub, { color: '#767775' }]}>Agile & Independent</Text>
              </View>
            </View>
          </View>

          {/* Vital Statistics */}
          <View style={styles.sectionBlock}>
            <Text style={[styles.sectionLabel, { color: '#767775' }]}>VITAL STATISTICS</Text>
            <View style={styles.vitalsRow}>
              <View style={[styles.vitalCard, { backgroundColor: '#F9F9F9', borderColor: '#F0F0F0' }]}>
                <Text style={[styles.vitalLabel, { color: '#767775' }]}>CURRENT AGE</Text>
                <View style={styles.vitalInputRow}>
                  <TextInput 
                    style={[styles.vitalInput, { color: '#2e2f2d' }]}
                    value={petData.ageYears}
                    onChangeText={petData.setAgeYears}
                    keyboardType="numeric"
                    placeholder="2"
                    placeholderTextColor="#E5E7EB"
                  />
                  <Text style={[styles.vitalUnit, { color: '#5b5c5a' }]}>Years</Text>
                </View>
              </View>
              <View style={[styles.vitalCard, { backgroundColor: '#F9F9F9', borderColor: '#F0F0F0' }]}>
                <Text style={[styles.vitalLabel, { color: '#767775' }]}>WEIGHT</Text>
                <View style={styles.vitalInputRow}>
                  <TextInput 
                    style={[styles.vitalInput, { color: '#2e2f2d' }]}
                    value={petData.weight}
                    onChangeText={petData.setWeight}
                    keyboardType="numeric"
                    placeholder="12"
                    placeholderTextColor="#E5E7EB"
                  />
                  <Text style={[styles.vitalUnit, { color: '#5b5c5a' }]}>kg</Text>
                </View>
              </View>
            </View>
          </View>

          {/* Weight Goal Slider Visual */}
          <View style={styles.sectionBlock}>
            <View style={styles.goalHeaderRow}>
              <View>
                <Text style={[styles.sectionLabel, { color: '#767775', marginBottom: 4 }]}>HEALTH TARGET</Text>
                <Text style={[styles.goalTitle, { color: '#2e2f2d' }]}>Weight Goal</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.goalValue, { color: '#605e00' }]}>10.5</Text>
                <Text style={[styles.sectionLabel, { color: '#767775' }]}>KG TARGET</Text>
              </View>
            </View>

            {/* Custom Slider Track */}
            <View style={styles.sliderContainer}>
              <View style={[styles.sliderTrack, { backgroundColor: '#F0F0F0' }]} />
              <View style={[styles.sliderFill, { backgroundColor: '#FFFC00', width: '30%' }]} />
              <View style={[styles.sliderThumbButton, { left: '30%' }]} />
              
              <View style={styles.sliderLabels}>
                <Text style={[styles.sliderLabelText, { color: '#adadab' }]}>LEAN</Text>
                <Text style={[styles.sliderLabelText, { color: '#adadab' }]}>HEALTHY</Text>
                <Text style={[styles.sliderLabelText, { color: '#adadab' }]}>OVERWEIGHT</Text>
              </View>
            </View>
          </View>

          {/* Breed Discovery */}
          <View style={[styles.sectionBlock, { marginBottom: 32 }]}>
            <View style={[styles.searchPill, { backgroundColor: '#F0F0F0' }]}>
              <MaterialIcons name="search" size={24} color="#767775" />
              <Text style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: '500', color: '#767775', marginLeft: 16 }}>Search Breed...</Text>
            </View>

            <View style={styles.tagsContainer}>
              <View style={[styles.tagActive, { backgroundColor: '#FFFC00' }]}>
                <Text style={[styles.tagActiveText, { color: '#000000' }]}>Golden Retriever</Text>
              </View>
              <View style={[styles.tagInactive, { backgroundColor: '#F9F9F9', borderColor: '#F0F0F0' }]}>
                <Text style={[styles.tagInactiveText, { color: '#5b5c5a' }]}>Labrador</Text>
              </View>
              <View style={[styles.tagInactive, { backgroundColor: '#F9F9F9', borderColor: '#F0F0F0' }]}>
                <Text style={[styles.tagInactiveText, { color: '#5b5c5a' }]}>Beagle</Text>
              </View>
              <View style={[styles.tagInactive, { backgroundColor: '#F9F9F9', borderColor: '#F0F0F0' }]}>
                <Text style={[styles.tagInactiveText, { color: '#5b5c5a' }]}>Poodle</Text>
              </View>
            </View>
          </View>

        </View>
      </ScrollView>

      {/* Sticky Footer */}
      <View style={styles.stickyFooterContainer}>
        <LinearGradient
          colors={['transparent', 'rgba(255,255,255,0.95)', '#FFFFFF']}
          style={[styles.footerGradient, { paddingBottom: insets.bottom + 24 }]}
          locations={[0, 0.4, 1]}
        >
          <View style={styles.footerRow}>
            <TouchableOpacity 
              style={[styles.backBtnFlat, { backgroundColor: '#F9F9F9', borderColor: '#F0F0F0' }]}
              onPress={() => router.back()}
            >
              <MaterialIcons name="arrow-back" size={24} color="#5b5c5a" />
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.continueBtn}
              onPress={() => router.push('/onboarding/goal')}
              activeOpacity={0.9}
            >
              <LinearGradient
                colors={['#FFFC00', '#fac129']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.continueBtnGradient}
              >
                <Text style={[styles.continueBtnText, { color: '#000000' }]}>CONTINUE</Text>
                <MaterialIcons name="arrow-forward" size={24} color="#000000" />
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </LinearGradient>
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden' },
  blobTopRight: {
    position: 'absolute',
    top: '-10%',
    right: '-10%',
    width: 400,
    height: 400,
    borderRadius: 200,
  },
  blobBottomLeft: {
    position: 'absolute',
    bottom: '10%',
    left: '-20%',
    width: 300,
    height: 300,
    borderRadius: 150,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingBottom: 160,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 48,
    paddingHorizontal: 8,
  },
  progressActive: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    marginRight: 16,
  },
  progressInactive: {
    width: 48,
    height: 8,
    borderRadius: 4,
    marginRight: 16,
  },
  header: {
    marginBottom: 32,
  },
  avatarPickerRoot: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: '#F9F9F9',
    borderWidth: 2,
    borderColor: '#F0F0F0',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 4,
  },
  avatarPickerImage: {
    width: '100%',
    height: '100%',
    borderRadius: 70,
  },
  avatarPickerPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarPickerBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#FFFC00',
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 48,
    lineHeight: 48,
    letterSpacing: -1,
    marginBottom: 16,
  },
  subtitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 18,
    lineHeight: 28,
  },
  formSection: {
    gap: 48,
  },
  sectionBlock: {
    width: '100%',
  },
  sectionLabel: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 10,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  identRow: {
    flexDirection: 'row',
    gap: 16,
  },
  pillInput: {
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    paddingHorizontal: 24,
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 20,
  },
  speciesBento: {
    flexDirection: 'row',
    height: 256,
    gap: 16,
  },
  dogCard: {
    flex: 7,
    borderRadius: 16,
    padding: 24,
    justifyContent: 'space-between',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  bentoTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900',
    fontSize: 24,
    fontStyle: 'italic',
  },
  bentoSub: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 14,
  },
  flare: {
    position: 'absolute',
    right: -40,
    bottom: -40,
    width: 160,
    height: 160,
    borderRadius: 80,
  },
  catCard: {
    flex: 5,
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
    justifyContent: 'space-between',
  },
  catTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 20,
  },
  catSub: {
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 12,
  },
  vitalsRow: {
    flexDirection: 'row',
    gap: 16,
  },
  vitalCard: {
    flex: 1,
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    gap: 8,
  },
  vitalLabel: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  vitalInputRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  vitalInput: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900',
    fontSize: 36,
    width: 64,
    padding: 0,
  },
  vitalUnit: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 14,
  },
  goalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingHorizontal: 8,
    marginBottom: 16,
  },
  goalTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 24,
  },
  goalValue: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900',
    fontSize: 32,
    fontStyle: 'italic',
  },
  sliderContainer: {
    marginTop: 8,
    height: 64,
    justifyContent: 'center',
  },
  sliderTrack: {
    width: '100%',
    height: 48,
    borderRadius: 24,
    position: 'absolute',
  },
  sliderFill: {
    height: 48,
    borderRadius: 24,
    position: 'absolute',
  },
  sliderThumbButton: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FFFC00',
    borderWidth: 4,
    borderColor: '#000000',
    marginLeft: -16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginTop: 64, // Push below track
  },
  sliderLabelText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 10,
    letterSpacing: 2,
  },
  searchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 64,
    borderRadius: 32,
    paddingHorizontal: 24,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 16,
  },
  tagActive: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  tagActiveText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 14,
  },
  tagInactive: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
  },
  tagInactiveText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '600',
    fontSize: 14,
  },
  stickyFooterContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  footerGradient: {
    paddingHorizontal: 24,
    paddingTop: 48,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  backBtnFlat: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  continueBtn: {
    flex: 1,
    height: 64,
    borderRadius: 32,
    shadowColor: '#FFFC00',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 40,
    elevation: 8,
  },
  continueBtnGradient: {
    flex: 1,
    borderRadius: 32,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  continueBtnText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900',
    fontSize: 18,
    letterSpacing: -0.5,
  }
});
