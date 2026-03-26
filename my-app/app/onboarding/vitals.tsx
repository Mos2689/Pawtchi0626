import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Image, Switch, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors } from '../../constants/Theme';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { usePetStore } from '../../store/usePetStore';

const DOG_BREEDS = [
  "Mixed Breed", "Labrador Retriever", "French Bulldog", "German Shepherd", "Golden Retriever", 
  "Bulldog", "Poodle", "Beagle", "Rottweiler", "Yorkshire Terrier", "Dachshund", 
  "Boxer", "Husky", "Corgi", "Pug", "Australian Shepherd", "Shih Tzu", "Pomeranian", "Other"
];

const CAT_BREEDS = [
  "Mixed Breed / Domestic Shorthair", "Domestic Longhair", "Ragdoll", "Maine Coon", "Persian", 
  "British Shorthair", "Sphynx", "Bengal", "Abyssinian", "Scottish Fold", "Siamese", "Russian Blue", "Other"
];

// Screen 2: Vital Stats (Step 3 in UI)
export default function VitalsScreen() {
  const router = useRouter();
  const theme = Colors.light;
  const insets = useSafeAreaInsets();
  
  const { 
    species,
    name, setName, 
    breed, setBreed,
    ageYears, setAgeYears, 
    weight, setWeight, 
    isNeutered, setIsNeutered,
    imageUri, setImageUri
  } = usePetStore();

  const [breedModalVisible, setBreedModalVisible] = useState(false);

  const pickImage = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      setImageUri(result.assets[0].uri);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: '#FFFFFF' }]}>
      {/* Top Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={styles.headerLeft}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <MaterialIcons name="arrow-back" size={24} color={theme['on-surface']} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: theme['on-surface'] }]}>Pet Journey</Text>
        </View>
        <View style={[styles.stepBadge, { backgroundColor: '#F1F5F9' }]}>
          <Text style={[styles.stepText, { color: theme['on-surface-variant'] }]}>Step 3 of 4</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        
        {/* Headline */}
        <View style={styles.headlineSection}>
          <View style={[styles.blurBlob, { backgroundColor: 'rgba(255,252,0,0.1)' }]} />
          <Text style={[styles.mainHeading, { color: theme['on-surface'] }]}>
            Tell us about your buddy.
          </Text>
          <Text style={[styles.subHeading, { color: theme['on-surface-variant'] }]}>
            We&apos;ll use these stats to calculate their daily needs.
          </Text>
        </View>

        {/* Form Container */}
        <View style={styles.formContainer}>
          
          {/* Image Upload Section */}
          <View style={{ alignItems: 'center', marginBottom: 16 }}>
            <TouchableOpacity onPress={pickImage} style={styles.avatarPickerRoot} activeOpacity={0.8}>
              {imageUri ? (
                <Image source={{ uri: imageUri }} style={styles.avatarPickerImage} />
              ) : (
                <View style={styles.avatarPickerPlaceholder}>
                  <MaterialIcons name="add-a-photo" size={32} color="#adadab" />
                  <Text style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: '700', color: '#adadab', fontSize: 10, marginTop: 4 }}>UPLOAD</Text>
                </View>
              )}
              <View style={styles.avatarPickerBadge}>
                <MaterialIcons name="edit" size={14} color="#000" />
              </View>
            </TouchableOpacity>
          </View>

          {/* Pet Name */}
          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: theme['on-surface-variant'] }]}>Pet Name</Text>
            <View style={styles.inputWrapper}>
              <TextInput 
                style={[styles.input, { backgroundColor: '#FFFFFF', borderColor: 'rgba(209,213,225,0.3)' }]}
                placeholder="e.g. Barnaby"
                placeholderTextColor={theme['outline-variant']}
                value={name}
                onChangeText={setName}
              />
              <MaterialIcons name="pets" size={24} color={theme['on-surface-variant']} style={styles.inputIcon} />
            </View>
          </View>

          {/* Breed */}
          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: theme['on-surface-variant'] }]}>Breed (Optional)</Text>
            <TouchableOpacity 
              style={[styles.inputWrapper, { height: 64, borderWidth: 1, borderColor: 'rgba(209,213,225,0.3)', borderRadius: 16, backgroundColor: '#FFFFFF', paddingHorizontal: 20, justifyContent: 'center' }]}
              onPress={() => setBreedModalVisible(true)}
              activeOpacity={0.7}
            >
              <Text style={[{ fontFamily: 'Plus Jakarta Sans', fontWeight: '600', fontSize: 16 }, breed ? { color: '#000000' } : { color: theme['outline-variant'] }]}>
                {breed || "Select a Breed..."}
              </Text>
              <MaterialIcons name="expand-more" size={24} color={theme['on-surface-variant']} style={{ position: 'absolute', right: 20 }} />
            </TouchableOpacity>
          </View>

          {/* Bento Grid (Age / Weight) */}
          <View style={styles.bentoGrid}>
            <View style={styles.bentoItem}>
              <Text style={[styles.label, { color: theme['on-surface-variant'] }]}>Age (Years)</Text>
              <TextInput 
                style={[styles.bentoInput, { backgroundColor: '#FFFFFF', borderColor: 'rgba(209,213,225,0.3)' }]}
                placeholder="2"
                placeholderTextColor={theme['outline-variant']}
                keyboardType="numeric"
                value={ageYears}
                onChangeText={setAgeYears}
                textAlign="center"
              />
            </View>
            <View style={styles.bentoItem}>
              <Text style={[styles.label, { color: theme['on-surface-variant'] }]}>Weight (kg)</Text>
              <TextInput 
                style={[styles.bentoInput, { backgroundColor: '#FFFFFF', borderColor: 'rgba(209,213,225,0.3)' }]}
                placeholder="12.5"
                placeholderTextColor={theme['outline-variant']}
                keyboardType="numeric"
                value={weight}
                onChangeText={setWeight}
                textAlign="center"
              />
            </View>
          </View>

          {/* Toggle Card */}
          <View style={[styles.toggleCard, { backgroundColor: '#F8F9FA', borderColor: 'rgba(209,213,225,0.2)' }]}>
            <View style={styles.toggleLeft}>
              <View style={[styles.toggleIconContainer, { backgroundColor: '#FFFC00' }]}>
                <MaterialIcons name="medical-services" size={24} color="#000000" />
              </View>
              <View>
                <Text style={[styles.toggleTitle, { color: theme['on-surface'] }]}>Desexed</Text>
                <Text style={[styles.toggleSubtitle, { color: theme['on-surface-variant'] }]}>Important for calorie tracking</Text>
              </View>
            </View>
            <Switch 
              value={isNeutered} 
              onValueChange={setIsNeutered} 
              trackColor={{ false: '#f1f5f9', true: '#FFFC00' }}
              thumbColor="#FFFFFF"
            />
          </View>

          {/* Decorative Visual Card */}
          <View style={styles.decorativeContainer}>
            <View style={[styles.decorativeBlur, { backgroundColor: 'rgba(255,252,0,0.1)' }]} />
            <View style={[styles.decorativeCard, { backgroundColor: '#FFFFFF', borderColor: 'rgba(209,213,225,0.2)' }]}>
              <Image 
                source={{ uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCuq9b2sfmCI1kyQij1fFOS-ExiC6u8sJZD3DBN263YLeYZa3tOEd_Ttiytu8h_YUUSqManvAdG2Yyr59dPXQp5A-SFuyavlu0edh5Rz7JYkIIRj7Dm0funkDftfbubZloxdmJkbF8bluV7tKrfqmgNvdTHvrg9LJoRudpkcphxtVZjYxW5R7EkSpAN1dIhiHuRi1yXsXIBMo9AZPWBgwQEDXnBd7lbwuwUM728q26RT195tXPPfflmzBaSBuD59EAaswv5BkYf71c' }} 
                style={styles.decorativeImg}
              />
              <View style={styles.decorativeTextContainer}>
                <Text style={[styles.decorativeLabel, { color: theme['on-surface'] }]}>QUICK TIP</Text>
                <Text style={[styles.decorativeBody, { color: theme['on-surface-variant'] }]}>Active pups need more protein!</Text>
              </View>
            </View>
          </View>

        </View>

      </ScrollView>

      {/* Breed Selection Action Sheet Modal */}
      <Modal visible={breedModalVisible} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Breed</Text>
              <TouchableOpacity onPress={() => setBreedModalVisible(false)} style={styles.modalCloseBtn}>
                <MaterialIcons name="close" size={24} color="#0f172a" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {(species === 'cat' ? CAT_BREEDS : DOG_BREEDS).map(b => (
                <TouchableOpacity 
                  key={b} 
                  style={styles.modalItem}
                  onPress={() => { setBreed(b); setBreedModalVisible(false); }}
                >
                  <Text style={[styles.modalItemText, breed === b && { color: '#000000', fontWeight: '800' }]}>{b}</Text>
                  {breed === b && <MaterialIcons name="check" size={20} color="#000000" />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Sticky Footer */}
      <View style={styles.stickyFooterContainer}>
        <LinearGradient
          colors={['transparent', 'rgba(255,255,255,0.95)', '#FFFFFF']}
          style={[styles.footerGradient, { paddingBottom: insets.bottom + 40 }]}
          locations={[0, 0.4, 1]}
        >
          <TouchableOpacity 
            style={[styles.nextBtn, { backgroundColor: '#FFFC00' }]}
            onPress={() => router.push('/onboarding/goal')}
            activeOpacity={0.9}
          >
            <Text style={[styles.nextBtnText, { color: '#243036' }]}>Next</Text>
            <MaterialIcons name="chevron-right" size={24} color="#243036" />
          </TouchableOpacity>
        </LinearGradient>
      </View>
      
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
    zIndex: 50,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  backBtn: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 28,
    letterSpacing: -0.5,
  },
  stepBadge: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
  },
  stepText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 14,
    letterSpacing: 0.5,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 160, // Space for sticky footer
    alignItems: 'center',
  },
  headlineSection: {
    width: '100%',
    marginBottom: 24,
    alignItems: 'center',
  },
  avatarPickerRoot: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#F9F9F9',
    borderWidth: 2,
    borderColor: '#e2e8f0',
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
    borderRadius: 60,
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
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  blurBlob: {
    position: 'absolute',
    top: -24,
    right: -16,
    width: 96,
    height: 96,
    borderRadius: 48,
  },
  mainHeading: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 36,
    lineHeight: 40,
    letterSpacing: -1,
    marginBottom: 8,
    textAlign: 'center',
  },
  subHeading: {
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 18,
    textAlign: 'center',
  },
  formContainer: {
    width: '100%',
    gap: 24,
  },
  inputGroup: {
    width: '100%',
    gap: 8,
  },
  label: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 14,
    marginLeft: 16,
  },
  inputWrapper: {
    width: '100%',
    justifyContent: 'center',
  },
  input: {
    width: '100%',
    height: 64,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 24,
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '600',
    fontSize: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  inputIcon: {
    position: 'absolute',
    right: 20,
  },
  bentoGrid: {
    flexDirection: 'row',
    gap: 16,
  },
  bentoItem: {
    flex: 1,
    gap: 8,
  },
  bentoInput: {
    width: '100%',
    height: 80,
    borderWidth: 1,
    borderRadius: 24,
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  toggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 24,
    borderRadius: 24,
    borderWidth: 1,
  },
  toggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  toggleIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toggleTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 16,
  },
  toggleSubtitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 12,
  },
  decorativeContainer: {
    marginTop: 16,
    alignItems: 'center',
    width: '100%',
  },
  decorativeBlur: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    borderRadius: 40,
  },
  decorativeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 40,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 4,
    gap: 16,
    maxWidth: '90%',
  },
  decorativeImg: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  decorativeTextContainer: {
    paddingRight: 24,
  },
  decorativeLabel: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 2,
  },
  decorativeBody: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '500',
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
    paddingTop: 24,
    alignItems: 'center',
  },
  nextBtn: {
    width: 250, // Matches max-w-xl scale roughly 
    maxWidth: '100%',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 20,
    borderRadius: 40,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 15,
    elevation: 8,
    gap: 8,
  },
  nextBtnText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 20,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    maxHeight: '70%',
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  modalTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 20,
    color: '#0f172a',
  },
  modalCloseBtn: {
    padding: 8,
    backgroundColor: '#f8fafc',
    borderRadius: 20,
  },
  modalScroll: {
    paddingHorizontal: 24,
  },
  modalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f8fafc',
  },
  modalItemText: {
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 16,
    color: '#334155',
  }
});
