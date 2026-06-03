import { SafeAreaView } from 'react-native-safe-area-context';
import React from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Image } from 'react-native';
import { Typography } from '../../components/Typography';
import { Header } from '../../components/Header';
import { Colors } from '../../constants/Theme';
import { MaterialIcons } from '@expo/vector-icons';

// Screen 7: Best Mates Feed
export default function BestMatesScreen() {
  const theme = Colors.light;

  const mates = [
    { id: 1, name: 'Buddy & Luna', action: 'completed a 2 mile walk together', time: '1h ago', likes: 12, comments: 3 },
    { id: 2, name: 'Charlie', action: 'completed a training session', time: '3h ago', likes: 24, comments: 1 },
    { id: 3, name: 'Bella', action: 'is looking for a playdate this weekend', time: '5h ago', likes: 8, comments: 12 },
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <Header title="Best Mates" />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        
        {/* Story Circles */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storyScroll}>
            {['You', 'Buddy', 'Luna', 'Charlie', 'Bella', 'Duke'].map((name, i) => (
                <View key={i} style={styles.storyContainer}>
                    <View style={[styles.storyCircle, i === 0 && { borderColor: theme.outline, borderWidth: 1 }]} />
                    {i === 0 && (
                        <View style={[styles.addStoryBtn, { backgroundColor: theme.primary }]}>
                            <MaterialIcons name="add" size={16} color={theme['on-primary']} />
                        </View>
                    )}
                    <Typography variant="label" size={12} weight="bold" color="on-surface" style={{ marginTop: 8 }}>{name}</Typography>
                </View>
            ))}
        </ScrollView>

        <View style={styles.divider} />

        {mates.map(mate => (
            <View key={mate.id} style={[styles.feedCard, { borderColor: theme['surface-container-highest'] }]}>
                <View style={styles.feedHeader}>
                    <View style={styles.avatar} />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                        <Typography variant="label" weight="bold" size={16}>{mate.name}</Typography>
                        <Typography variant="body" size={14} color="on-surface-variant">{mate.action}</Typography>
                    </View>
                    <MaterialIcons name="more-horiz" size={24} color={theme['outline']} />
                </View>
                
                {/* Image Placeholder */}
                <View style={[styles.feedImage, { backgroundColor: theme['surface-container-low'] }]}>
                    <MaterialIcons name="photo" size={48} color={theme['outline-variant']} />
                </View>

                <View style={styles.feedActions}>
                    <TouchableOpacity style={styles.actionBtn}>
                        <MaterialIcons name="favorite-border" size={24} color={theme['on-surface']} />
                        <Typography variant="label" weight="bold" style={{ marginLeft: 6 }}>{mate.likes}</Typography>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.actionBtn}>
                        <MaterialIcons name="chat-bubble-outline" size={24} color={theme['on-surface']} />
                        <Typography variant="label" weight="bold" style={{ marginLeft: 6 }}>{mate.comments}</Typography>
                    </TouchableOpacity>
                    <View style={{ flex: 1 }} />
                    <TouchableOpacity>
                        <Typography variant="label" color="on-surface-variant">{mate.time}</Typography>
                    </TouchableOpacity>
                </View>
            </View>
        ))}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingBottom: 140 },
  storyScroll: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24, gap: 16 },
  storyContainer: { alignItems: 'center' },
  storyCircle: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: '#ccc',
      borderWidth: 3,
      borderColor: '#FFFC00', // theme.primary
  },
  addStoryBtn: {
      position: 'absolute',
      right: 0,
      bottom: 20,
      width: 24,
      height: 24,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 2,
      borderColor: '#FFF',
  },
  divider: { height: 1, backgroundColor: '#DEE2E6', marginHorizontal: 24, marginBottom: 24 },
  feedCard: {
      marginHorizontal: 24,
      marginBottom: 24,
      borderWidth: 1,
      borderRadius: 24,
      padding: 16,
  },
  feedHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#ddd' },
  feedImage: {
      height: 200,
      borderRadius: 16,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 16,
  },
  feedActions: { flexDirection: 'row', alignItems: 'center' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', marginRight: 24 }
});
