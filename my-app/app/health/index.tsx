import { SafeAreaView } from 'react-native-safe-area-context';
import React from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Typography } from '../../components/Typography';
import { Header } from '../../components/Header';
import { MaterialIcons } from '@expo/vector-icons';
import { color, font, radius, shadow, space } from '../../constants/design';

// Screen 12: Health Hub
export default function HealthHubScreen() {

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Health Hub" />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        
        {/* Vitals Summary Card */}
        <View style={styles.mainCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="headline" weight="bold" size={24} color="on-primary">Vitals Overview</Typography>
                <MaterialIcons name="monitor-heart" size={32} color={color.navy} />
            </View>
            <Typography variant="body" color="on-primary" style={{ opacity: 0.8, marginTop: space.xs, marginBottom: space.xxl }}>Last updated yesterday</Typography>
            
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
        <Typography variant="headline" weight="bold" size={20} style={{ marginTop: space.xxxl, marginBottom: space.lg }}>Health Records</Typography>
        <View style={{ gap: space.md }}>
            {[
                { label: 'Vaccination History', icon: 'vaccines', iconBg: color.track },
                { label: 'Medical Conditions', icon: 'medical-information', iconBg: '#ffb19a' },
                { label: 'Vet Appointments', icon: 'event-available', iconBg: color.yellowSoft },
            ].map((menu, i) => (
                <TouchableOpacity key={i} style={styles.menuBtn}>
                    <View style={[styles.menuIcon, { backgroundColor: menu.iconBg }]}>
                        <MaterialIcons name={menu.icon as any} size={24} color={color.ink} />
                    </View>
                    <Typography variant="headline" weight="bold" size={16} style={{ flex: 1, marginLeft: space.lg }}>{menu.label}</Typography>
                    <MaterialIcons name="chevron-right" size={24} color={color.slateFaint} />
                </TouchableOpacity>
            ))}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.surface },
  scrollContent: { paddingHorizontal: space.xxl, paddingBottom: 140, paddingTop: space.lg },
  mainCard: {
      padding: space.xxl,
      borderRadius: radius.xl,
      backgroundColor: color.yellow,
      ...shadow.raised,
  },
  vitalsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      backgroundColor: 'rgba(255,255,255,0.2)',
      borderRadius: radius.lg,
      padding: space.lg,
  },
  vitalStat: { alignItems: 'center', flex: 1 },
  vitalDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.3)', marginHorizontal: space.sm },
  menuBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: space.lg,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: color.hairline,
      backgroundColor: color.surface,
      ...shadow.card,
  },
  menuIcon: {
      width: 48,
      height: 48,
      borderRadius: 24,
      justifyContent: 'center',
      alignItems: 'center',
  }
});
