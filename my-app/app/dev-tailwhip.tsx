/**
 * DEV-ONLY — Tail Whip playground. DELETE BEFORE SHIP.
 *
 * Validates the WIPE mechanism (MaskedView + moving gradient, tail rides the
 * seam) with dummy mapless screens, so we can confirm the mask renders
 * correctly on both iOS and Android before wiring the real walk screen.
 *
 *   • Instant → the summary is ready immediately (revealed behind the tail).
 *   • Slow    → summary not ready: the wipe reveals a white "Saving…" state,
 *               then the content fades in when ready. Never yellow.
 *
 * Open via /dev-tailwhip (Expo dev menu) or pawtchi://dev-tailwhip.
 */

import React, { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, radius, space, type } from '../constants/design';
import { AnimatedPressable } from '../components/AnimatedPressable';
import { BreathingPaw } from '../components/BreathingPaw';
import { TailWhipSuccessTransition } from '../components/transitions/TailWhipSuccessTransition';

type Scenario = 'instant' | 'slow';

export default function DevTailWhipScreen() {
  // expo-router turns every file in app/ into a route, so this playground ships
  // in release builds and is reachable via pawtchi://dev-tailwhip. It renders
  // dummy data only, but an unguarded dev route is needless surface and App
  // Review has flagged them before. Delete the file once the wipe is settled.
  if (!__DEV__) return null;

  if (!__DEV__) return <Redirect href="/(tabs)" />;
  return <Playground />;
}

// A stand-in "old screen" — bold enough to clearly see it get wiped away.
function DummyLive() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.live, { paddingTop: insets.top + space.xxl }]}>
      <Text style={styles.liveEyebrow}>TRACKED WALK</Text>
      <Text style={styles.liveTitle}>Live screen</Text>
      <Text style={styles.liveBody}>This is the OLD screen.{'\n'}The tail wipes it away.</Text>
      <View style={styles.grid}>
        {Array.from({ length: 12 }).map((_, i) => (
          <View key={i} style={styles.gridCell} />
        ))}
      </View>
    </View>
  );
}

function DummySummary({ revealed, saving }: { revealed: boolean; saving: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.summary, { paddingTop: insets.top + space.xxl }]}>
      {saving ? (
        <View style={styles.savingBox}>
          <BreathingPaw size={34} workingColor={color.navy} />
          <Text style={styles.savingText}>Saving Bruno&rsquo;s walk</Text>
        </View>
      ) : (
        <>
          <BreathingPaw settled={revealed} size={28} />
          <Text style={styles.sumTitle}>Good walk, Bruno</Text>
          <Text style={styles.sumBody}>This is the NEW screen — revealed behind the tail. No yellow.</Text>
          <View style={styles.statRow}>
            {['58 MIN', '4.62 KM', '312 KCAL'].map(s => (
              <Text key={s} style={styles.stat}>{s}</Text>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

function Playground() {
  const insets = useSafeAreaInsets();
  const [runId, setRunId] = useState(0);
  const [active, setActive] = useState(false);
  const [ready, setReady] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = (scenario: Scenario) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setRunId(id => id + 1); // remount the overlay — one-shot per mount
    setActive(false);
    setReady(false);
    setRevealed(false);
    requestAnimationFrame(() => {
      setActive(true);
      if (scenario === 'instant') setReady(true);
      else timerRef.current = setTimeout(() => setReady(true), 1500);
    });
  };

  return (
    <View style={styles.root}>
      {/* Base layer behind the overlay: the current (old) screen while the
          whip plays, the new screen once it's done. */}
      {active ? <DummyLive /> : revealed ? <DummySummary revealed saving={false} /> : <DummyLive />}

      {active && (
        <TailWhipSuccessTransition
          key={runId}
          visible
          onComplete={() => {
            setActive(false);
            setRevealed(true);
          }}
        >
          <DummySummary revealed={ready} saving={!ready} />
        </TailWhipSuccessTransition>
      )}

      <View style={[styles.controls, { paddingBottom: insets.bottom + space.xl }]}>
        <AnimatedPressable style={styles.btn} onPress={() => run('instant')}>
          <Text style={styles.btnText}>Instant</Text>
        </AnimatedPressable>
        <AnimatedPressable style={styles.btn} onPress={() => run('slow')}>
          <Text style={styles.btnText}>Slow save</Text>
        </AnimatedPressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.surfaceSubtle },
  live: { flex: 1, alignItems: 'center', gap: space.sm, backgroundColor: '#0B2A36' },
  liveEyebrow: { ...type.caption, color: color.yellow },
  liveTitle: { ...type.title, color: color.cream },
  liveBody: { ...type.body, color: color.creamDim, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginTop: space.xl, paddingHorizontal: space.xl },
  gridCell: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: 'rgba(244,241,236,0.10)' },
  summary: { flex: 1, alignItems: 'center', gap: space.md, backgroundColor: color.surface },
  sumTitle: { ...type.title, color: color.navy },
  sumBody: { ...type.body, color: color.slateMuted, textAlign: 'center', paddingHorizontal: space.xxl },
  statRow: { flexDirection: 'row', gap: space.xl, marginTop: space.md },
  stat: { ...type.label, color: color.navy },
  savingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg },
  savingText: { ...type.bodyMedium, color: color.slateMuted },
  controls: {
    position: 'absolute',
    left: space.xxl,
    right: space.xxl,
    bottom: 0,
    flexDirection: 'row',
    gap: space.md,
  },
  btn: { flex: 1, backgroundColor: color.yellow, borderRadius: radius.pill, paddingVertical: 14, alignItems: 'center' },
  btnText: { ...type.heading, color: color.navy },
});
