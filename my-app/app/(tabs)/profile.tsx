import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, Switch } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '../../constants/Theme';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../providers/AuthProvider';
import { useActivePetStore } from '../../store/useActivePetStore';
import { useStreakStore } from '../../store/useStreakStore';
import { usePetContextStore } from '../../store/usePetContextStore';

// Screen 6: Profile & Settings
export default function ProfileScreen() {
  const router = useRouter();
  const theme = Colors.light;
  const insets = useSafeAreaInsets();

  const { user } = useAuth();
  const { activePet, clearPet } = useActivePetStore();
  const { clearStreak } = useStreakStore();
  const { clearContext } = usePetContextStore();

  const [feedingToggle, setFeedingToggle] = useState(true);
  const [walkToggle, setWalkToggle] = useState(true);
  const [hydrationToggle, setHydrationToggle] = useState(false);

  const handleSignOut = async () => {
    clearPet();
    clearStreak();
    clearContext();
    await supabase.auth.signOut();
    // Wait for the auth listener in `_layout` to kick us out
  };

  return (
    <View style={[styles.container, { backgroundColor: '#FFFFFF' }]}>
      
      {/* Top Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={styles.headerLeft}>
          <View style={[styles.avatarMini, { borderColor: '#1a1a00' }]}>
            <Image 
              source={{ uri: activePet?.image_url || 'https://images.unsplash.com/photo-1543466835-00a7907e9de1?q=80&w=1000&auto=format&fit=crop' }} 
              style={styles.avatarMiniImg}
            />
          </View>
          <Text style={[styles.headerTitle, { color: '#1a1a00' }]}>PAWTCHI</Text>
        </View>
        <TouchableOpacity style={styles.bellBtn}>
          <MaterialIcons name="notifications" size={28} color="#1a1a00" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        
        {/* Hero Profile Section */}
        <View style={styles.heroSection}>
          <LinearGradient colors={['#FFFC00', '#e6e300']} style={styles.heroGradient}>
            {/* Background Blob */}
            <View style={[styles.heroBlob, { backgroundColor: 'rgba(255,255,255,0.2)' }]} />
            
            <View style={styles.heroContent}>
              <View style={[styles.mainAvatar, { borderColor: '#FFFFFF' }]}>
                <Image 
                  source={{ uri: activePet?.image_url || 'https://images.unsplash.com/photo-1583337130417-3346a1be7dee?q=80&w=1000&auto=format&fit=crop' }}
                  style={styles.mainAvatarImg}
                />
              </View>
              <View style={styles.heroInfo}>
                <Text style={[styles.heroName, { color: '#1a1a00' }]}>{activePet?.name || 'My Pet'}</Text>
                <Text style={[styles.heroDesc, { color: '#4d4d00', textTransform: 'capitalize' }]}>
                  {activePet?.breed || activePet?.species} • {activePet?.age_years ? `${activePet.age_years} Years Old` : 'Age Unknown'}
                </Text>
                
                <View style={styles.tagsRow}>
                  <View style={[styles.tagPill, { backgroundColor: 'rgba(255,255,255,0.3)', borderColor: 'rgba(255,255,255,0.2)' }]}>
                    <Text style={[styles.tagText, { color: '#1a1a00' }]}>Active Walker</Text>
                  </View>
                  <View style={[styles.tagPill, { backgroundColor: 'rgba(255,255,255,0.3)', borderColor: 'rgba(255,255,255,0.2)' }]}>
                    <Text style={[styles.tagText, { color: '#1a1a00' }]}>Pro Eater</Text>
                  </View>
                </View>
              </View>
            </View>
          </LinearGradient>
        </View>

        {/* Bento Grid: Pet Details */}
        <View style={styles.bentoGrid}>
          {/* Weight */}
          <View style={[styles.bentoCard, { backgroundColor: '#FFFFFF', borderColor: '#f1f5f9' }]}>
            <MaterialIcons name="monitor-weight" size={32} color="#1a1a00" />
            <Text style={[styles.bentoValue, { color: '#0f172a' }]}>{activePet?.current_weight_kg || 0} kg</Text>
            <Text style={[styles.bentoLabel, { color: '#64748b' }]}>WEIGHT</Text>
          </View>
          {/* Age */}
          <View style={[styles.bentoCard, { backgroundColor: '#FFFFFF', borderColor: '#f1f5f9' }]}>
            <MaterialIcons name="cake" size={32} color="#1a1a00" />
            <Text style={[styles.bentoValue, { color: '#0f172a' }]}>{activePet?.age_years || '?'} yrs</Text>
            <Text style={[styles.bentoLabel, { color: '#64748b' }]}>AGE</Text>
          </View>
        </View>
        {/* Energy Level Span */}
        <View style={[styles.bentoSpanCard, { backgroundColor: '#ffe4dc', marginBottom: 24 }]}>
          <MaterialIcons name="bolt" size={32} color="#a83206" />
          <Text style={[styles.bentoValue, { color: '#862400', textTransform: 'capitalize' }]}>
             {activePet?.activity_level ? activePet.activity_level.replace('_', ' ') : 'N/A'}
          </Text>
          <Text style={[styles.bentoLabel, { color: '#862400' }]}>ENERGY LEVEL</Text>
        </View>

        {/* Advanced Medical Nudge */}
        <TouchableOpacity 
          style={styles.medicalNudgeCard}
          onPress={() => router.push('/medical')}
          activeOpacity={0.9}
        >
          <LinearGradient
            colors={['#0f172a', '#1e293b']}
            style={styles.medicalGradient}
          >
            <View style={styles.medicalLeft}>
              <MaterialIcons name="health-and-safety" size={32} color="#FFFC00" />
              <View>
                <Text style={styles.medicalTitle}>Clinical Profile</Text>
                <Text style={styles.medicalSub}>Unlock precise AI health tracking.</Text>
              </View>
            </View>
            <MaterialIcons name="arrow-forward-ios" size={16} color="#94a3b8" />
          </LinearGradient>
        </TouchableOpacity>

        {/* Notification Settings Section */}
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="notifications-active" size={24} color="#0f172a" />
            <Text style={[styles.sectionTitle, { color: '#0f172a' }]}>Reminders & Alerts</Text>
          </View>
          
          <View style={[styles.settingsGroup, { backgroundColor: '#f8fafc', borderColor: '#f1f5f9' }]}>
            
            {/* Feeding Times */}
            <View style={[styles.settingRow, { backgroundColor: '#FFFFFF', borderColor: '#f1f5f9' }]}>
              <View style={styles.settingRowLeft}>
                <View style={[styles.settingIconBg, { backgroundColor: '#fef8c3' }]}>
                  <MaterialIcons name="restaurant" size={24} color="#605d34" />
                </View>
                <View>
                  <Text style={[styles.settingName, { color: '#0f172a' }]}>Feeding Times</Text>
                  <Text style={[styles.settingSub, { color: '#64748b' }]}>Next: 06:00 PM</Text>
                </View>
              </View>
              <Switch 
                value={feedingToggle} 
                onValueChange={setFeedingToggle} 
                trackColor={{ false: '#e2e8f0', true: '#FFFC00' }}
                thumbColor={feedingToggle ? '#FFFFFF' : '#FFFFFF'}
              />
            </View>

            {/* Walk Schedule */}
            <View style={[styles.settingRow, { backgroundColor: '#FFFFFF', borderColor: '#f1f5f9' }]}>
              <View style={styles.settingRowLeft}>
                <View style={[styles.settingIconBg, { backgroundColor: 'rgba(255,252,0,0.2)' }]}>
                  <MaterialIcons name="directions-walk" size={24} color="#1a1a00" />
                </View>
                <View>
                  <Text style={[styles.settingName, { color: '#0f172a' }]}>Walk Schedule</Text>
                  <Text style={[styles.settingSub, { color: '#64748b' }]}>Daily at 07:00 AM</Text>
                </View>
              </View>
              <Switch 
                value={walkToggle} 
                onValueChange={setWalkToggle} 
                trackColor={{ false: '#e2e8f0', true: '#FFFC00' }}
                thumbColor={walkToggle ? '#FFFFFF' : '#FFFFFF'}
              />
            </View>

            {/* Hydration Tracker */}
            <View style={[styles.settingRow, { backgroundColor: '#FFFFFF', borderColor: '#f1f5f9' }]}>
              <View style={styles.settingRowLeft}>
                <View style={[styles.settingIconBg, { backgroundColor: '#f1f5f9' }]}>
                  <MaterialIcons name="water-drop" size={24} color="#94a3b8" />
                </View>
                <View>
                  <Text style={[styles.settingName, { color: '#0f172a' }]}>Hydration Tracker</Text>
                  <Text style={[styles.settingSub, { color: '#64748b' }]}>Every 4 hours</Text>
                </View>
              </View>
              <Switch 
                value={hydrationToggle} 
                onValueChange={setHydrationToggle} 
                trackColor={{ false: '#e2e8f0', true: '#FFFC00' }}
                thumbColor={hydrationToggle ? '#FFFFFF' : '#FFFFFF'}
              />
            </View>

          </View>
        </View>

        {/* Account Settings */}
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="manage-accounts" size={24} color="#0f172a" />
            <Text style={[styles.sectionTitle, { color: '#0f172a' }]}>Account Info</Text>
          </View>

          <View style={[styles.accountGroup, { backgroundColor: '#FFFFFF', borderColor: '#f1f5f9' }]}>
            <TouchableOpacity style={styles.accountRow} activeOpacity={0.7}>
              <View style={styles.accountRowLeft}>
                <MaterialIcons name="person" size={24} color="#94a3b8" />
                <Text style={[styles.accountName, { color: '#0f172a' }]}>Owner Profile</Text>
              </View>
              <MaterialIcons name="chevron-right" size={24} color="#94a3b8" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.accountRow} activeOpacity={0.7}>
              <View style={styles.accountRowLeft}>
                <MaterialIcons name="payment" size={24} color="#94a3b8" />
                <Text style={[styles.accountName, { color: '#0f172a' }]}>Billing & Subscription</Text>
              </View>
              <MaterialIcons name="chevron-right" size={24} color="#94a3b8" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.accountRow} activeOpacity={0.7}>
              <View style={styles.accountRowLeft}>
                <MaterialIcons name="security" size={24} color="#94a3b8" />
                <Text style={[styles.accountName, { color: '#0f172a' }]}>Privacy & Security</Text>
              </View>
              <MaterialIcons name="chevron-right" size={24} color="#94a3b8" />
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.accountRow, { borderBottomWidth: 0 }]} 
              activeOpacity={0.7}
              onPress={handleSignOut}
            >
              <View style={styles.accountRowLeft}>
                <MaterialIcons name="logout" size={24} color="#b02500" />
                <Text style={[styles.accountName, { color: '#b02500' }]}>Logout</Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 16,
    backgroundColor: '#FFFFFF',
    zIndex: 50,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatarMini: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    backgroundColor: '#FFFC00',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarMiniImg: {
    width: '100%',
    height: '100%',
  },
  headerTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 24,
    letterSpacing: -0.5,
  },
  bellBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 120, // accommodate tab bar
  },
  heroSection: {
    marginBottom: 24,
  },
  heroGradient: {
    borderRadius: 24,
    padding: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 8,
    position: 'relative',
    overflow: 'hidden',
  },
  heroBlob: {
    position: 'absolute',
    top: -40,
    right: -40,
    width: 160,
    height: 160,
    borderRadius: 80,
  },
  heroContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
    zIndex: 10,
  },
  mainAvatar: {
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 4,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 8,
  },
  mainAvatarImg: {
    width: '100%',
    height: '100%',
  },
  heroInfo: {
    flex: 1,
  },
  heroName: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900',
    fontSize: 32,
    letterSpacing: -0.5,
  },
  heroDesc: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '600',
    fontSize: 14,
    marginTop: 4,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 16,
  },
  tagPill: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  tagText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 12,
  },
  bentoGrid: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 16,
  },
  bentoCard: {
    flex: 1,
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  bentoSpanCard: {
    width: '100%',
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  bentoValue: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900',
    fontSize: 24,
    marginTop: 8,
  },
  bentoLabel: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 1,
    marginTop: 4,
  },
  medicalNudgeCard: {
    marginHorizontal: 0,
    marginBottom: 32,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 8,
  },
  medicalGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 24,
    borderRadius: 24,
  },
  medicalLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  medicalTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 18,
    color: '#FFFC00',
    marginBottom: 2,
  },
  medicalSub: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '500',
    fontSize: 13,
    color: '#94a3b8',
  },
  sectionContainer: {
    marginBottom: 32,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  sectionTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900',
    fontSize: 20,
  },
  settingsGroup: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
    gap: 8,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  settingRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  settingIconBg: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingName: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 16,
    marginBottom: 2,
  },
  settingSub: {
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 14,
    fontStyle: 'italic',
  },
  accountGroup: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  accountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  accountRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  accountName: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '600',
    fontSize: 16,
  }
});
