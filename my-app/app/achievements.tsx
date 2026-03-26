import { SafeAreaView } from 'react-native-safe-area-context';
import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Typography } from '../components/Typography';
import { Header } from '../components/Header';
import { Colors } from '../constants/Theme';
import { MaterialIcons } from '@expo/vector-icons';

// Screen 8: Achievements
export default function AchievementsScreen() {
  const theme = Colors.light;

  const achievements = [
    { id: 1, title: 'Step Master', desc: 'Reached 10,000 steps passing 3 days.', icon: 'directions-walk', unlocked: true, color: theme.primary },
    { id: 2, title: 'Perfect Diet', desc: 'Logged food for 7 consecutive days.', icon: 'restaurant', unlocked: true, color: '#ffc4b3' },
    { id: 3, title: 'Social Butterfly', desc: 'Added 5 new best mates.', icon: 'group', unlocked: false, color: '#DEE2E6' },
    { id: 4, title: 'Early Bird', desc: 'Logged activity before 7 AM.', icon: 'wb-sunny', unlocked: true, color: '#fef8c3' },
    { id: 5, title: 'Marathon', desc: 'Walked over 5 miles in a single day.', icon: 'map', unlocked: false, color: '#DEE2E6' },
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <Header title="Achievements" />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        
        {/* Top Stats */}
        <View style={styles.statsRow}>
            <View style={styles.statBox}>
                <Typography variant="headline" weight="extrabold" size={32} color="primary-fixed-dim">3</Typography>
                <Typography variant="label" weight="bold" color="on-surface-variant">Unlocked</Typography>
            </View>
            <View style={styles.statBox}>
                <Typography variant="headline" weight="extrabold" size={32} color="on-surface">5</Typography>
                <Typography variant="label" weight="bold" color="on-surface-variant">Total Trophies</Typography>
            </View>
        </View>

        <Typography variant="headline" weight="bold" size={20} style={{ marginTop: 24, marginBottom: 16 }}>Your Trophies</Typography>

        <View style={styles.grid}>
            {achievements.map((ach) => (
                 <View key={ach.id} style={[styles.card, { backgroundColor: ach.unlocked ? ach.color : theme['surface-container-low'], opacity: ach.unlocked ? 1 : 0.6 }]}>
                     <View style={styles.iconCircle}>
                         <MaterialIcons name={ach.icon as any} size={40} color={ach.unlocked ? theme['on-surface'] : theme['outline']} />
                     </View>
                     <Typography variant="headline" weight="bold" size={18} align="center" style={{ marginTop: 16, marginBottom: 8 }}>{ach.title}</Typography>
                     <Typography variant="body" size={14} color="on-surface-variant" align="center">{ach.desc}</Typography>
                     
                     {ach.unlocked && (
                         <View style={[styles.badge, { backgroundColor: theme.surface }]}>
                             <MaterialIcons name="done" size={14} color={theme['on-surface']} />
                         </View>
                     )}
                 </View>
            ))}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 140, paddingTop: 16 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, marginBottom: 16 },
  statBox: {
      flex: 1,
      padding: 24,
      borderRadius: 24,
      backgroundColor: 'rgba(0,0,0,0.03)',
      alignItems: 'center',
  },
  grid: { gap: 16 },
  card: {
      padding: 24,
      borderRadius: 24,
      alignItems: 'center',
  },
  iconCircle: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: 'rgba(255,255,255,0.5)',
      justifyContent: 'center',
      alignItems: 'center',
  },
  badge: {
      position: 'absolute',
      top: 16,
      right: 16,
      padding: 6,
      borderRadius: 16,
      elevation: 2,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
  }
});
