import { SafeAreaView } from 'react-native-safe-area-context';
import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Typography } from '../components/Typography';
import { Header } from '../components/Header';
import { MaterialIcons } from '@expo/vector-icons';
import { color, font, radius, shadow, space } from '../constants/design';

// Screen 8: Achievements
export default function AchievementsScreen() {

  const achievements = [
    { id: 1, title: 'Step Master', desc: 'Reached 10,000 steps passing 3 days.', icon: 'directions-walk', unlocked: true, color: color.yellow },
    { id: 2, title: 'Perfect Diet', desc: 'Logged food for 7 consecutive days.', icon: 'restaurant', unlocked: true, color: '#ffc4b3' },
    { id: 3, title: 'Social Butterfly', desc: 'Added 5 new best mates.', icon: 'group', unlocked: false, color: color.track },
    { id: 4, title: 'Early Bird', desc: 'Logged activity before 7 AM.', icon: 'wb-sunny', unlocked: true, color: color.yellowSoft },
    { id: 5, title: 'Marathon', desc: 'Walked over 5 miles in a single day.', icon: 'map', unlocked: false, color: color.track },
  ];

  return (
    <SafeAreaView style={styles.container}>
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

        <Typography variant="headline" weight="bold" size={20} style={{ marginTop: space.xxl, marginBottom: space.lg }}>Your Trophies</Typography>

        <View style={styles.grid}>
            {achievements.map((ach) => (
                 <View key={ach.id} style={[styles.card, { backgroundColor: ach.unlocked ? ach.color : color.track, opacity: ach.unlocked ? 1 : 0.6 }]}>
                     <View style={styles.iconCircle}>
                         <MaterialIcons name={ach.icon as any} size={40} color={ach.unlocked ? color.ink : color.slateFaint} />
                     </View>
                     <Typography variant="headline" weight="bold" size={18} align="center" style={{ marginTop: space.lg, marginBottom: space.sm }}>
                       {ach.title}
                     </Typography>
                     <Typography variant="body" size={14} color="on-surface-variant" align="center">{ach.desc}</Typography>
                     
                     {ach.unlocked && (
                         <View style={styles.badge}>
                             <MaterialIcons name="done" size={14} color={color.ink} />
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
  container: { flex: 1, backgroundColor: color.surface },
  scrollContent: { paddingHorizontal: space.xxl, paddingBottom: 140, paddingTop: space.lg },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space.lg, marginBottom: space.lg },
  statBox: {
      flex: 1,
      padding: space.xxl,
      borderRadius: radius.xl,
      backgroundColor: color.surfaceSubtle,
      alignItems: 'center',
  },
  grid: { gap: space.lg },
  card: {
      padding: space.xxl,
      borderRadius: radius.xl,
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
      top: space.lg,
      right: space.lg,
      padding: 6,
      borderRadius: radius.lg,
      backgroundColor: color.surface,
      ...shadow.card,
  }
});
