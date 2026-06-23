import { SafeAreaView } from 'react-native-safe-area-context';
import React from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Typography } from '../../components/Typography';
import { Header } from '../../components/Header';
import { MaterialIcons } from '@expo/vector-icons';
import { color, font, radius, shadow, space } from '../../constants/design';

// Screen 7: Best Mates Feed
export default function BestMatesScreen() {

  const mates = [
    { id: 1, name: 'Buddy & Luna', action: 'completed a 2 mile walk together', time: '1h ago', likes: 12, comments: 3 },
    { id: 2, name: 'Charlie', action: 'completed a training session', time: '3h ago', likes: 24, comments: 1 },
    { id: 3, name: 'Bella', action: 'is looking for a playdate this weekend', time: '5h ago', likes: 8, comments: 12 },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Best Mates" />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        
        {/* Story Circles */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storyScroll}>
            {['You', 'Buddy', 'Luna', 'Charlie', 'Bella', 'Duke'].map((name, i) => (
                <View key={i} style={styles.storyContainer}>
                    <View style={[styles.storyCircle, i === 0 && { borderColor: color.slateFaint, borderWidth: 1 }]} />
                    {i === 0 && (
                        <View style={[styles.addStoryBtn, { backgroundColor: color.yellow }]}>
                            <MaterialIcons name="add" size={16} color={color.navy} />
                        </View>
                    )}
                    <Typography variant="label" size={12} weight="bold" color="on-surface" style={{ marginTop: space.sm }}>{name}</Typography>
                </View>
            ))}
        </ScrollView>

        <View style={styles.divider} />

        {mates.map(mate => (
            <View key={mate.id} style={styles.feedCard}>
                <View style={styles.feedHeader}>
                    <View style={styles.avatar} />
                    <View style={{ flex: 1, marginLeft: space.md }}>
                        <Typography variant="label" weight="bold" size={16}>{mate.name}</Typography>
                        <Typography variant="body" size={14} color="on-surface-variant">{mate.action}</Typography>
                    </View>
                    <MaterialIcons name="more-horiz" size={24} color={color.slateFaint} />
                </View>
                
                {/* Image Placeholder */}
                <View style={styles.feedImage}>
                    <MaterialIcons name="photo" size={48} color={color.slateFaint} />
                </View>

                <View style={styles.feedActions}>
                    <TouchableOpacity style={styles.actionBtn}>
                        <MaterialIcons name="favorite-border" size={24} color={color.ink} />
                        <Typography variant="label" weight="bold" style={{ marginLeft: 6 }}>{mate.likes}</Typography>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.actionBtn}>
                        <MaterialIcons name="chat-bubble-outline" size={24} color={color.ink} />
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
  container: { flex: 1, backgroundColor: color.surface },
  scrollContent: { paddingBottom: 140 },
  storyScroll: { paddingHorizontal: space.xxl, paddingTop: space.lg, paddingBottom: space.xxl, gap: space.lg },
  storyContainer: { alignItems: 'center' },
  storyCircle: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: color.slateFaint,
      borderWidth: 3,
      borderColor: color.yellow,
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
      borderColor: color.surface,
  },
  divider: { height: 1, backgroundColor: color.hairline, marginHorizontal: space.xxl, marginBottom: space.xxl },
  feedCard: {
      marginHorizontal: space.xxl,
      marginBottom: space.xxl,
      borderWidth: 1,
      borderColor: color.hairline,
      borderRadius: radius.xl,
      padding: space.lg,
      backgroundColor: color.surface,
      ...shadow.card,
  },
  feedHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: space.lg },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: color.track },
  feedImage: {
      height: 200,
      borderRadius: radius.lg,
      backgroundColor: color.surfaceSubtle,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: space.lg,
  },
  feedActions: { flexDirection: 'row', alignItems: 'center' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', marginRight: space.xxl }
});
