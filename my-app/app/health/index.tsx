import { SafeAreaView } from 'react-native-safe-area-context';
import React from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Typography } from '../../components/Typography';
import { Header } from '../../components/Header';
import { Colors } from '../../constants/Theme';
import { MaterialIcons } from '@expo/vector-icons';

// Screen 12: Health Hub
export default function HealthHubScreen() {
  const theme = Colors.light;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <Header title="Health Hub" />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        
        {/* Vitals Summary Card */}
        <View style={[styles.mainCard, { backgroundColor: theme.primary }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="headline" weight="bold" size={24} color="on-primary">Vitals Overview</Typography>
                <MaterialIcons name="monitor-heart" size={32} color={theme['on-primary']} />
            </View>
            <Typography variant="body" color="on-primary" style={{ opacity: 0.8, marginTop: 4, marginBottom: 24 }}>Last updated yesterday</Typography>
            
            <View style={styles.vitalsRow}>
                <View style={styles.vitalStat}>
                    <Typography variant="headline" weight="extrabold" size={28} color="on-primary">45</Typography>
                    <Typography variant="label" weight="bold" color="on-primary">LBS</Typography>
                </View>
                <View style={styles.vitalDivider} />
                <View style={styles.vitalStat}>
                    <Typography variant="headline" weight="extrabold" size={28} color="on-primary">72</Typography>
                    <Typography variant="label" weight="bold" color="on-primary">BPM</Typography>
                </View>
                <View style={styles.vitalDivider} />
                <View style={styles.vitalStat}>
                    <Typography variant="headline" weight="extrabold" size={28} color="on-primary">101</Typography>
                    <Typography variant="label" weight="bold" color="on-primary">°F</Typography>
                </View>
            </View>
        </View>

        {/* Action Menu */}
        <Typography variant="headline" weight="bold" size={20} style={{ marginTop: 32, marginBottom: 16 }}>Health Records</Typography>
        <View style={{ gap: 12 }}>
            {[
                { label: 'Vaccination History', icon: 'vaccines', color: '#DEE2E6' },
                { label: 'Medical Conditions', icon: 'medical-information', color: '#ffb19a' },
                { label: 'Vet Appointments', icon: 'event-available', color: '#fef8c3' },
            ].map((menu, i) => (
                <TouchableOpacity key={i} style={[styles.menuBtn, { backgroundColor: theme['surface-container-low'], borderColor: theme['surface-container-highest'] }]}>
                    <View style={[styles.menuIcon, { backgroundColor: menu.color }]}>
                        <MaterialIcons name={menu.icon as any} size={24} color={theme['on-surface']} />
                    </View>
                    <Typography variant="headline" weight="bold" size={16} style={{ flex: 1, marginLeft: 16 }}>{menu.label}</Typography>
                    <MaterialIcons name="chevron-right" size={24} color={theme['outline']} />
                </TouchableOpacity>
            ))}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 140, paddingTop: 16 },
  mainCard: {
      padding: 24,
      borderRadius: 24,
      elevation: 4,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.1,
      shadowRadius: 24,
  },
  vitalsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      backgroundColor: 'rgba(255,255,255,0.2)',
      borderRadius: 16,
      padding: 16,
  },
  vitalStat: { alignItems: 'center', flex: 1 },
  vitalDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.3)', marginHorizontal: 8 },
  menuBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
      borderRadius: 20,
      borderWidth: 1,
  },
  menuIcon: {
      width: 48,
      height: 48,
      borderRadius: 24,
      justifyContent: 'center',
      alignItems: 'center',
  }
});
