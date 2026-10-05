/**
 * SPIKE-ONLY — Live Walk v2 Phase A recorder. Lives on spike/live-walk-a only.
 *
 * TestFlight only — delete before an App Store release. Only the accounts in
 * private.live_spike_testers can join its room (lib/dev/liveSpike.ts). Open with
 * pawtchi://dev-live-spike. Runbook: supabase/spike/RUNBOOK.md.
 */

import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { color, font, radius, space, type } from '../constants/design';
import {
  deleteAllRuns,
  listRuns,
  manualPing,
  note,
  probe,
  shareFullLog,
  shareSummary,
  startSpike,
  stopSpike,
  suggestedMeetup,
  useLiveSpike,
} from '../lib/dev/liveSpike';
import type { SpikeRole } from '../lib/dev/liveSpikeSummary';

const NOTES = ['Locking now', 'Unlocked', 'Walking', 'Standing still', 'Walk ended'];

export default function DevLiveSpikeScreen() {
  return <Recorder />;
}

function Button({ label, onPress, tone = 'plain', disabled = false }: {
  label: string;
  onPress: () => void;
  tone?: 'plain' | 'primary' | 'danger';
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, tone === 'primary' && styles.primary, tone === 'danger' && styles.danger, disabled && styles.disabled]}
    >
      <Text style={styles.buttonLabel}>{label}</Text>
    </Pressable>
  );
}

function Recorder() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // Opened from a link with the app closed, there is nothing behind this
  // screen to go back to, so Close falls through to Home. Leaving never stops
  // a run: the recorder lives outside this screen.
  const close = () => { if (router.canGoBack()) router.back(); else router.replace('/(tabs)' as never); };
  const view = useLiveSpike();
  const [room, setRoom] = useState('a1');
  const [meetup, setMeetup] = useState(suggestedMeetup);
  const [role, setRole] = useState<SpikeRole>('walker');
  const [runs, setRuns] = useState<string[]>([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    setRuns(listRuns());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [view.running]);

  const start = async () => {
    try {
      await startSpike(room.trim().toLowerCase(), role, meetup.trim().toLowerCase() || null);
    } catch (cause) {
      Alert.alert('Could not start', String((cause as { message?: unknown })?.message ?? cause));
    }
  };

  const latest = view.runId ?? runs[0] ?? null;
  const tokenLeft = view.tokenExp ? Math.round(view.tokenExp - now / 1000) : null;

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.xxxl }]}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Live walk spike</Text>
        <Button label="Close" onPress={close} />
      </View>
      {view.running ? <Text style={styles.label}>Recording. Close this screen and lock the phone as you like; it keeps going until you press Stop here.</Text> : null}

      <Text style={styles.label}>Room (the same short name on both phones)</Text>
      <TextInput
        value={room}
        onChangeText={setRoom}
        editable={!view.running}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />
      <Text style={styles.label}>Meetup id for database changes (filled in while recording a meetup; optional)</Text>
      <TextInput
        value={meetup}
        onChangeText={setMeetup}
        editable={!view.running}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />
      <View style={styles.row}>
        {(['walker', 'viewer'] as const).map(option => (
          <Button key={option} label={option} tone={role === option ? 'primary' : 'plain'} disabled={view.running} onPress={() => setRole(option)} />
        ))}
      </View>
      <View style={styles.row}>
        {view.running
          ? <Button label="Stop" tone="danger" onPress={stopSpike} />
          : <Button label="Start" tone="primary" onPress={() => { void start(); }} />}
        <Button label="Ping now" disabled={!view.running} onPress={manualPing} />
      </View>

      <View style={styles.card}>
        <Text style={styles.stat}>me {view.me ?? '–'} · socket {view.conn} · channel {view.channel}</Text>
        <Text style={styles.stat}>peers {view.peers.length ? view.peers.join(', ') : 'none'}</Text>
        <Text style={styles.stat}>sent {view.sent} · failed {view.failed} · skipped {view.skipped} · received {view.received} · db {view.dbChanges}</Text>
        <Text style={styles.stat}>token expires in {tokenLeft === null ? '–' : `${Math.floor(tokenLeft / 60)} min ${tokenLeft % 60} s`}</Text>
      </View>

      <Text style={styles.label}>Mark what you are doing</Text>
      <View style={styles.wrap}>
        {NOTES.map(text => <Button key={text} label={text} disabled={!view.running} onPress={() => note(text)} />)}
      </View>

      <Text style={styles.label}>Isolation probes (45 s each, while pings are flowing)</Text>
      <View style={styles.row}>
        <Button label={view.probing === 'public' ? 'Probing…' : 'Public join'} disabled={!view.running || !!view.probing} onPress={() => { void probe('public'); }} />
        <Button label={view.probing === 'anon_private' ? 'Probing…' : 'Signed-out private'} disabled={!view.running || !!view.probing} onPress={() => { void probe('anon_private'); }} />
      </View>

      <Text style={styles.label}>Results {latest ? `(${latest})` : ''}</Text>
      <View style={styles.row}>
        <Button label="Share summary" disabled={!latest} onPress={() => { if (latest) void shareSummary(latest); }} />
        <Button label="Share full log" disabled={!latest} onPress={() => { if (latest) void shareFullLog(latest); }} />
      </View>
      {runs.length > 1 && <Text style={styles.stat}>{runs.length} runs saved on this phone</Text>}
      <Button
        label="Delete all runs"
        disabled={view.running || runs.length === 0}
        onPress={() => Alert.alert('Delete all spike runs?', 'Share them first if you still need them.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => { deleteAllRuns(); setRuns([]); } },
        ])}
      />

      <Text style={styles.label}>Latest events</Text>
      {view.lines.map((line, index) => <Text key={`${index}-${line}`} style={styles.line}>{line}</Text>)}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.surface },
  content: { paddingHorizontal: space.lg, gap: space.md },
  title: { ...type.title, color: color.ink, flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  label: { ...type.label, color: color.slate, marginTop: space.sm },
  input: {
    ...type.body,
    color: color.ink,
    borderWidth: 1,
    borderColor: color.hairline,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  row: { flexDirection: 'row', gap: space.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  button: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.hairline,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    backgroundColor: color.surfaceSubtle,
  },
  primary: { backgroundColor: color.yellow, borderColor: color.yellow },
  danger: { backgroundColor: color.errorSoft, borderColor: color.error },
  disabled: { opacity: 0.4 },
  buttonLabel: { ...type.label, color: color.ink },
  card: { borderRadius: radius.lg, backgroundColor: color.surfaceSubtle, padding: space.md, gap: space.xs },
  stat: { ...type.body, color: color.ink },
  line: { fontFamily: font.regular, fontSize: 11, lineHeight: 15, color: color.slateMuted },
});
