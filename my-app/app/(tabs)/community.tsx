import { SafeAreaView } from 'react-native-safe-area-context';
import React from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Image } from 'react-native';
import { Typography } from '../../components/Typography';
import { Header } from '../../components/Header';
import { Button } from '../../components/Button';
import { Colors } from '../../constants/Theme';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

// Screen 14: Community
export default function CommunityScreen() {
  const router = useRouter();
  const theme = Colors.light;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <Header title="Community" showBack={false} rightElement={
        <TouchableOpacity style={{ padding: 8 }}>
            <MaterialIcons name="notifications-none" size={24} color={theme['on-surface']} />
        </TouchableOpacity>
      } />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        
        {/* Banner */}
        <View style={[styles.banner, { backgroundColor: theme['tertiary-container'] }]}>
          <View style={{ flex: 1 }}>
            <Typography variant="headline" weight="bold" size={20} color="on-tertiary-container" style={{ marginBottom: 4 }}>
                Local Meetups
            </Typography>
            <Typography variant="body" size={14} color="on-tertiary-container">
                Join our weekend pack walk at Riverside Park!
            </Typography>
            <Button 
                title="RSVP" 
                variant="primary" 
                style={{ marginTop: 16, alignSelf: 'flex-start', paddingVertical: 10, paddingHorizontal: 20 }} 
                textStyle={{ fontSize: 14 }}
            />
          </View>
          <MaterialIcons name="event" size={60} color={theme.tertiary} style={{ opacity: 0.2, position: 'absolute', right: 20, bottom: 20 }} />
        </View>

        {/* Categories */}
        <Typography variant="headline" weight="bold" size={20} style={{ marginTop: 32, marginBottom: 16 }}>Explore</Typography>
        <View style={styles.categoriesGrid}>
            <TouchableOpacity style={[styles.catCard, { backgroundColor: theme['surface-container-low'] }]} onPress={() => router.push('/community/best-mates')}>
                <MaterialIcons name="favorite" size={32} color={theme.primary} />
                <Typography variant="label" weight="bold" size={14} style={{ marginTop: 12 }}>Best Mates</Typography>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.catCard, { backgroundColor: theme['surface-container-low'] }]}>
                <MaterialIcons name="forum" size={32} color={theme.secondary} />
                <Typography variant="label" weight="bold" size={14} style={{ marginTop: 12 }}>Discussions</Typography>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.catCard, { backgroundColor: theme['surface-container-low'] }]}>
                <MaterialIcons name="tips-and-updates" size={32} color={theme.tertiary} />
                <Typography variant="label" weight="bold" size={14} style={{ marginTop: 12 }}>Expert Tips</Typography>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.catCard, { backgroundColor: theme['surface-container-low'] }]}>
                <MaterialIcons name="celebration" size={32} color="#8a2be2" />
                <Typography variant="label" weight="bold" size={14} style={{ marginTop: 12 }}>Events</Typography>
            </TouchableOpacity>
        </View>

        {/* Featured Post */}
        <Typography variant="headline" weight="bold" size={20} style={{ marginTop: 32, marginBottom: 16 }}>Trending</Typography>
        <View style={[styles.postCard, { borderColor: theme['surface-container-highest'] }]}>
            <View style={styles.postHeader}>
                <View style={styles.avatar} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                    <Typography variant="label" weight="bold" size={14}>Dr. Alex</Typography>
                    <Typography variant="label" size={12} color="on-surface-variant">Veterinarian • 2h ago</Typography>
                </View>
            </View>
            <Typography variant="headline" weight="bold" size={18} style={{ marginBottom: 8 }}>Summer hydration tips</Typography>
            <Typography variant="body" size={14} color="on-surface-variant" style={{ lineHeight: 22 }}>
                As temperatures rise, it's crucial to keep your furry friends hydrated. Here are 3 signs your dog might need more water...
            </Typography>
            <View style={styles.postActions}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <MaterialIcons name="favorite-border" size={20} color={theme['on-surface-variant']} />
                    <Typography variant="label" size={14} color="on-surface-variant">245</Typography>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <MaterialIcons name="chat-bubble-outline" size={20} color={theme['on-surface-variant']} />
                    <Typography variant="label" size={14} color="on-surface-variant">42</Typography>
                </View>
            </View>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 140, paddingTop: 16 },
  banner: {
    padding: 24,
    borderRadius: 24,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  categoriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  catCard: {
    width: '47%',
    padding: 24,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postCard: {
    borderWidth: 1,
    borderRadius: 24,
    padding: 24,
  },
  postHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#ccc',
  },
  postActions: {
    flexDirection: 'row',
    gap: 24,
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#f1f3f5',
  }
});
