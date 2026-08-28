/**
 * Full-screen Scent Spectrum story player. Interaction follows familiar story
 * grammar: tap next/previous, hold to pause, and hold the closer for a
 * deliberate share choice. The existing Moment gallery remains the handoff.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';

import { track } from '../../lib/analytics';
import type { WalkStory } from '../../lib/walkStory';
import { MomentShareModal } from '../MomentShareModal';
import { StoryProgressBars } from './StoryProgressBars';
import { StorySlide, type StoryContext } from './StorySlide';
import { storyColor } from './storyTheme';

const TICK_MS = 50;
const BEAT_MS = 4200;

interface WalkStoryViewerProps {
  story: WalkStory;
  ctx: StoryContext;
  onClose: () => void;
}

export function WalkStoryViewer({ story, ctx, onClose }: WalkStoryViewerProps) {
  const insets = useSafeAreaInsets();
  const beats = story.beats;
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const progressRef = useRef(0);

  const isLast = index >= beats.length - 1;
  const currentBeat = beats[index];

  useEffect(() => {
    const filled = index >= beats.length - 1 ? 1 : 0;
    progressRef.current = filled;
    setProgress(filled);
    track('walk_story_beat_viewed', { beat: beats[index]?.id ?? 'unknown', index });
    if (index >= beats.length - 1) track('walk_story_completed', { beats: beats.length });
  }, [index, beats]);

  useEffect(() => {
    if (paused || shareOpen || isLast) return;
    const timer = setInterval(() => {
      progressRef.current += TICK_MS / BEAT_MS;
      if (progressRef.current >= 1) {
        progressRef.current = 0;
        setProgress(0);
        setIndex((current) => Math.min(current + 1, beats.length - 1));
      } else {
        setProgress(progressRef.current);
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [index, paused, shareOpen, isLast, beats.length]);

  const goNext = () => {
    if (isLast) {
      onClose();
      return;
    }
    setIndex((current) => Math.min(current + 1, beats.length - 1));
  };

  const goPrevious = () => setIndex((current) => Math.max(0, current - 1));

  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heldRef = useRef(false);
  const onZonePressIn = () => {
    heldRef.current = false;
    holdTimer.current = setTimeout(() => {
      heldRef.current = true;
      setPaused(true);
    }, 160);
  };
  const onZonePressOut = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    setPaused(false);
  };
  const onZonePress = (direction: 'next' | 'previous') => {
    if (heldRef.current) {
      heldRef.current = false;
      return;
    }
    if (direction === 'next') goNext();
    else goPrevious();
  };

  const openShare = () => {
    track('walk_story_shared', { beat: beats.length });
    setShareOpen(true);
  };

  return (
    <View style={styles.root}>
      <StatusBar style="dark" backgroundColor={storyColor.canvas} />

      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <View style={styles.zones}>
          <Pressable
            style={styles.zonePrevious}
            onPressIn={onZonePressIn}
            onPressOut={onZonePressOut}
            onPress={() => onZonePress('previous')}
            accessibilityLabel="Previous story"
          />
          <Pressable
            style={styles.zoneNext}
            onPressIn={onZonePressIn}
            onPressOut={onZonePressOut}
            onPress={() => onZonePress('next')}
            accessibilityLabel="Next story"
          />
        </View>
      </View>

      <View style={styles.slide} pointerEvents={isLast ? 'box-none' : 'none'}>
        <StorySlide
          beat={currentBeat}
          ctx={{ ...ctx, topInset: insets.top + 44 }}
          onShare={openShare}
          onClose={onClose}
        />
      </View>

      <View style={[styles.header, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <StoryProgressBars
          count={beats.length}
          index={index}
          progress={progress}
          inkColor={storyColor.ink}
          trackColor={storyColor.inkFaint}
        />
        <TouchableOpacity
          style={styles.close}
          onPress={onClose}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close walk story"
        >
          <MaterialIcons name="close" size={24} color={storyColor.ink} />
        </TouchableOpacity>
      </View>

      <MomentShareModal
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        source="walk_story"
        petName={ctx.petName}
        petGender={ctx.petGender}
        startedAt={ctx.startedAt}
        route={ctx.route}
        sniffStops={ctx.sniffStops}
        labels={ctx.labels}
        stats={ctx.stats}
        sessionId={ctx.sessionId}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: storyColor.canvas,
  },
  zones: {
    flex: 1,
    flexDirection: 'row',
  },
  zonePrevious: {
    width: '30%',
  },
  zoneNext: {
    flex: 1,
  },
  slide: {
    ...StyleSheet.absoluteFillObject,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 18,
    gap: 10,
  },
  close: {
    alignSelf: 'flex-end',
    padding: 4,
  },
});

