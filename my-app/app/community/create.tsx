/**
 * Starting a Trail.
 *
 * Three questions and nothing else: what it is called, where you meet, and
 * when — with the date optional, because a host often raises a Trail precisely
 * to find out who is free.
 *
 * This screen used to also collect a username and explain the privacy model in
 * a card, which made setting up a walk with two friends feel like filling in a
 * form. Neither belongs here. A username is how OTHER people find you, so it is
 * asked for on the trails list where it is actually needed, and the privacy
 * promise is kept by the invitation flow rather than by a paragraph.
 *
 * `?mode=username` still routes here: the trails list sends people who have not
 * chosen a handle yet, and that variant asks for exactly the one field.
 */

import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';

import {
  CommunityButton,
  CommunityDogsOnly,
  CommunityHeader,
  communityScreenStyles,
} from '../../components/community/CommunityUI';
import { MeetingPointField } from '../../components/community/MeetingPointField';
import { color, radius, space, type } from '../../constants/design';
import { useHomeMapCenter } from '../../hooks/useHomeMapCenter';
import { useWalkEnabled } from '../../hooks/useWalkEnabled';
import {
  createOuting,
  createPack,
  getMyUsername,
  isValidUsername,
  normalizeUsername,
  rememberNewPack,
  saveMyUsername,
  setOutingMeetingPoint,
} from '../../lib/communityWalks';
import {
  EMPTY_MEETING_POINT,
  isMeetingPointReady,
  isPinned,
  type MeetingPoint,
} from '../../lib/communityMeetingPoint';
import { useAuth } from '../../providers/AuthProvider';
import { useActivePetStore } from '../../store/useActivePetStore';

export default function CreateTrailScreen() {
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const usernameOnly = mode === 'username';
  const walkEnabled = useWalkEnabled();
  const activePet = useActivePetStore(state => state.activePet);
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [meeting, setMeeting] = useState<MeetingPoint>(EMPTY_MEETING_POINT);
  const [note, setNote] = useState('');
  const [hasDate, setHasDate] = useState(false);
  const [date, setDate] = useState(() => new Date(Date.now() + 24 * 60 * 60 * 1000));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();
  // The no-prompt centre — this owner's own geography, never a location ask.
  const { center: mapCenter } = useHomeMapCenter(activePet?.id ?? null, user?.id ?? null, walkEnabled && !usernameOnly);

  useEffect(() => {
    if (!usernameOnly) return;
    getMyUsername().then(value => value && setUsername(value)).catch(() => {});
  }, [usernameOnly]);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      if (usernameOnly) {
        await saveMyUsername(username);
        router.back();
        return;
      }
      const pack = await createPack(name);
      // Two calls rather than one transaction, and the recovery is the reason
      // it is acceptable: if the walk fails the Trail still exists and its own
      // screen opens on "Plan the first walk".
      try {
        const walk = await createOuting({
          packId: pack.id,
          title: name.trim(),
          scheduledFor: hasDate ? date.toISOString() : null,
          meetingLabel: meeting.label,
          note,
        });
        // The coordinate the host chose in the picker, not a guess about what
        // their words might have meant. Still unawaited and still allowed to
        // fail: the pin decorates the trail's card, and a trail without a map
        // is still a trail.
        if (isPinned(meeting)) {
          void setOutingMeetingPoint(walk.id, meeting.lat!, meeting.lng!).catch(() => {});
        }
        rememberNewPack(pack, walk);
      } catch {
        // The trail is real even though its first walk is not, so it still goes
        // on the list. Landing on its own screen is the recovery: it opens on
        // "Plan the first walk", which is exactly what is missing.
        rememberNewPack(pack, null);
        router.replace(`/community/${pack.id}` as never);
        return;
      }
      // Straight to inviting: a Trail with nobody on it is not yet the thing
      // the host came here to make. `from=create` is what tells that screen it
      // is the last step of something rather than a detour off a trail — it
      // finishes onto the Together list instead of back where it came from.
      router.replace(`/community/${pack.id}/invite?from=create` as never);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This trail could not be started.');
    } finally {
      setSaving(false);
    }
  };

  const ready = usernameOnly
    ? isValidUsername(username)
    : name.trim().length >= 2 && isMeetingPointReady(meeting);

  if (!walkEnabled && !usernameOnly) {
    return (
      <SafeAreaView style={communityScreenStyles.screen}>
        <CommunityDogsOnly petName={activePet?.name} onBack={() => router.back()} />
      </SafeAreaView>
    );
  }

  if (usernameOnly) {
    return (
      <SafeAreaView style={communityScreenStyles.screen}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <CommunityHeader
            title="How friends find you"
            subtitle="Only someone who types your exact username can find you. There is no people search."
            onBack={() => router.back()}
          />
          <ScrollView contentContainerStyle={communityScreenStyles.scroll} keyboardShouldPersistTaps="handled">
            <View style={styles.usernameField}>
              <Text style={styles.at}>@</Text>
              <TextInput
                value={username}
                onChangeText={value => { setUsername(normalizeUsername(value)); setError(null); }}
                placeholder="bella_and_sam"
                placeholderTextColor={color.slateFaint}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={24}
                style={styles.usernameInput}
                accessibilityLabel="Username"
              />
              {isValidUsername(username) ? <Ionicons name="checkmark-circle" size={21} color={color.success} /> : null}
            </View>
            {error ? <Text style={communityScreenStyles.error}>{error}</Text> : null}
            <CommunityButton
              label={saving ? 'Saving…' : 'Save username'}
              onPress={() => void submit()}
              disabled={!ready || saving}
              style={styles.submit}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={communityScreenStyles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* One row, the way the rest of the community screens do chrome: the
            back arrow, the title centred against it, and a spacer of the same
            width on the right so "centred" means centred on the SCREEN rather
            than on whatever is left over beside the arrow. */}
        <View style={styles.navRow}>
          <Pressable
            onPress={() => router.back()}
            style={styles.navButton}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={21} color={color.navy} />
          </Pressable>
          <Text style={styles.navTitle} numberOfLines={1}>Start a trail</Text>
          {/* Balances the arrow's width so the title is centred on the screen.
              Deliberately not `styles.navButton` — that carries the button's
              surface, which would draw a second, tappable-looking circle. */}
          <View style={styles.navSpacer} />
        </View>

        <ScrollView contentContainerStyle={communityScreenStyles.scroll} keyboardShouldPersistTaps="handled">
          <TextInput
            value={name}
            onChangeText={value => { setName(value); setError(null); }}
            placeholder="Name this trail"
            placeholderTextColor={color.slateFaint}
            maxLength={48}
            style={styles.bigField}
            accessibilityLabel="Trail name"
          />

          <MeetingPointField
            value={meeting}
            onChange={next => { setMeeting(next); setError(null); }}
            fallbackCenter={mapCenter}
          />

          <Pressable
            onPress={() => setHasDate(current => !current)}
            style={styles.dateRow}
            accessibilityRole="switch"
            accessibilityState={{ checked: hasDate }}
            accessibilityLabel={hasDate ? 'Pick a date now' : 'Decide the date later'}
          >
            <Ionicons
              name={hasDate ? 'calendar' : 'calendar-outline'}
              size={21}
              color={hasDate ? color.electric : color.slateMuted}
            />
            <Text style={[styles.dateText, !hasDate && styles.dateTextMuted]}>
              {hasDate
                ? new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }).format(date)
                : 'Add a date'}
            </Text>
            <Ionicons
              name={hasDate ? 'checkmark-circle' : 'add-circle-outline'}
              size={22}
              color={hasDate ? color.success : color.slateFaint}
            />
          </Pressable>

          {hasDate ? (
            <View style={styles.pickers}>
              <DateTimePicker
                value={date}
                mode="date"
                minimumDate={new Date()}
                display={Platform.OS === 'ios' ? 'compact' : 'default'}
                onChange={(_, value) => value && setDate(current => {
                  const next = new Date(value);
                  next.setHours(current.getHours(), current.getMinutes(), 0, 0);
                  return next;
                })}
              />
              <DateTimePicker
                value={date}
                mode="time"
                display={Platform.OS === 'ios' ? 'compact' : 'default'}
                onChange={(_, value) => value && setDate(current => {
                  const next = new Date(current);
                  next.setHours(value.getHours(), value.getMinutes(), 0, 0);
                  return next;
                })}
              />
            </View>
          ) : null}

          {/* Last, and optional, because it is the only question here without a
              right answer. Everything above is a fact about the walk; this is
              whatever the host knows that the fields cannot hold — which gate,
              what to bring, who is bringing the tennis ball. It rides on the
              first walk as its note, so it reaches the pack on the walk's own
              screen rather than sitting on a trail nobody opens. */}
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Anything the pack should know? (optional)"
            placeholderTextColor={color.slateFaint}
            maxLength={280}
            multiline
            style={[styles.bigField, styles.noteField]}
            accessibilityLabel="Instructions for the pack"
          />

          {error ? <Text style={communityScreenStyles.error}>{error}</Text> : null}
          <CommunityButton
            label={saving ? 'Starting…' : 'Start the trail'}
            onPress={() => void submit()}
            disabled={!ready || saving}
            style={styles.submit}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    marginBottom: space.md,
  },
  navButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface,
  },
  navSpacer: { width: 44, height: 44 },
  navTitle: { ...type.heading, fontSize: 18, color: color.navy, flex: 1, textAlign: 'center' },
  /**
   * One field style for every question, large enough to be the thing you look
   * at. Labels above each input were what made this screen feel like paperwork;
   * the placeholder asks the question instead, and there is only ever one
   * answer it could be.
   */
  bigField: {
    minHeight: 64,
    borderRadius: radius.lg,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.hairline,
    paddingHorizontal: space.lg,
    ...type.bodyMedium,
    fontSize: 17,
    color: color.ink,
    marginBottom: space.md,
  },
  /** Taller, and top-aligned: a paragraph starts at the top of its box. */
  noteField: { minHeight: 104, paddingTop: space.lg, textAlignVertical: 'top' },
  usernameField: {
    minHeight: 64, borderRadius: radius.lg, borderWidth: 1, borderColor: color.hairline,
    backgroundColor: color.surface, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg,
  },
  at: { ...type.heading, color: color.electric, marginRight: 2 },
  usernameInput: { flex: 1, ...type.bodyMedium, fontSize: 17, color: color.ink, minHeight: 62 },
  dateRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.lg,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.hairline,
    paddingHorizontal: space.lg,
  },
  dateText: { ...type.bodyMedium, fontSize: 17, color: color.ink, flex: 1 },
  dateTextMuted: { color: color.slateFaint },
  pickers: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.md },
  submit: { marginTop: space.xxl },
});
