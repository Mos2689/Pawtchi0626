import React from 'react';
import { View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { StorySlide, type StoryContext } from '../components/story/StorySlide';
import type { StoryBeat } from '../lib/walkStory';

const ROUTE = [
  { lat: 15.567, lng: 73.7535 },
  { lat: 15.568, lng: 73.7552 },
  { lat: 15.5674, lng: 73.7571 },
  { lat: 15.5658, lng: 73.7576 },
  { lat: 15.5649, lng: 73.7562 },
  { lat: 15.5651, lng: 73.7542 },
  { lat: 15.5662, lng: 73.7529 },
  { lat: 15.567, lng: 73.7535 },
];

const SNIFFS = [
  { ...ROUTE[1], dwellS: 55 },
  { ...ROUTE[2], dwellS: 90 },
  { ...ROUTE[3], dwellS: 180 },
  { ...ROUTE[4], dwellS: 75 },
  { ...ROUTE[5], dwellS: 48 },
  { ...ROUTE[6], dwellS: 110 },
];

const BEATS: Record<string, StoryBeat> = {
  opener: {
    id: 'opener',
    headline: 'Bruno followed his nose',
    dateLine: 'Sunday 26 July',
    chapter: 'Walk 42',
    speedLabel: '5.5 km/h',
  },
  sniff_spot: {
    id: 'sniff_spot',
    count: 6,
    longestDwellS: 180,
    line: 'The best one was worth waiting for.',
  },
  weather: {
    id: 'weather',
    tempLabel: '27°',
    conditionLabel: 'drizzle',
    line: '27° and drizzle. Out you went anyway.',
  },
  golden_hour: {
    id: 'golden_hour',
    phase: 'sunset',
    title: 'Golden hour',
    line: 'You caught the last of the light.',
  },
  fallback: {
    id: 'opener',
    headline: 'Bruno followed his nose',
    dateLine: 'Sunday 26 July',
    chapter: 'Walk 42',
    speedLabel: null,
  },
  closer: {
    id: 'closer',
    title: 'Keep this one',
    line: 'A walk with Bruno, drawn as it happened.',
  },
};

export default function DevStorySpectrum() {
  const { beat } = useLocalSearchParams<{ beat?: string }>();
  const { width, height } = useWindowDimensions();

  // See dev-tailwhip: routes under app/ ship in release builds, so gate the
  // playground out of production rather than leaving it deep-linkable.
  if (!__DEV__) return null;

  const key = typeof beat === 'string' && BEATS[beat] ? beat : 'opener';
  const ctx: StoryContext = {
    petName: 'Bruno',
    petGender: 'male',
    startedAt: new Date(2026, 6, 26, 10, 13).getTime(),
    route: key === 'fallback' ? [] : ROUTE,
    sniffStops: SNIFFS,
    labels: {
      startLabel: 'Arpora',
      endLabel: 'Arpora',
      farthestLabel: 'The long way round',
      isLoop: true,
    },
    stats: {
      durationS: 26 * 60,
      movingTimeS: 22 * 60,
      distanceM: 2400,
    },
    sessionId: 'spectrum-preview-42',
    slideW: width,
    slideH: height,
    walkNumber: 42,
    topInset: 64,
  };

  return (
    <View style={{ flex: 1 }}>
      <StorySlide beat={BEATS[key]} ctx={ctx} onShare={() => {}} onClose={() => {}} />
    </View>
  );
}
