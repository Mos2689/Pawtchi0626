/**
 * Choosing or changing the handle friends use to find you.
 *
 * ── One editor, three places ───────────────────────────────────────────────
 *
 * A username is asked for in the one-time prompt on Together, edited on the
 * owner's profile, and offered on the trails list. Three screens, one set of
 * rules — what counts as valid, what "taken" looks like, and the promise about
 * what a username is for. Written three times they drift, and the one that
 * drifts quietly is the promise.
 *
 * ── The promise, and why it is printed here ────────────────────────────────
 *
 * A username is the ONLY way another person can find this account, and it has
 * to be typed exactly. There is no people search, no suggestions, no directory.
 * That is not a limitation we are apologising for — it is the whole reason a
 * private trail stays private, and somebody being asked to pick a public-ish
 * handle is owed that context at the moment they are asked.
 */

import React from 'react';
import { describeError } from '../../lib/appError';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { color, font, radius, space, type } from '../../constants/design';
import { BreathingPaw } from '../BreathingPaw';
import { isValidUsername, normalizeUsername, saveMyUsername } from '../../lib/communityWalks';
import { useUsernameAvailability } from '../../hooks/useUsernameAvailability';
import { blocksSave, statusMessage, statusTone } from '../../lib/community/usernameStatus';
import { UsernameMark } from './UsernameMark';

interface UsernameEditorProps {
  /** What they have now, if anything. */
  initial?: string | null;
  onSaved: (username: string) => void;
  /** The button's words. "Save" on a profile, "Choose this" on a prompt. */
  saveLabel?: string;
  autoFocus?: boolean;
}

export function UsernameEditor({
  initial,
  onSaved,
  saveLabel = 'Save username',
  autoFocus = false,
}: UsernameEditorProps) {
  const [value, setValue] = React.useState(initial ?? '');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const valid = isValidUsername(value);
  const unchanged = normalizeUsername(value) === normalizeUsername(initial ?? '');

  // Checked as it is typed. `initial` is passed so someone retyping the handle
  // they already own is told it is theirs, not that it is taken.
  const status = useUsernameAvailability(value, initial);
  // A save error, once raised, outranks the live check: it is the more recent
  // and more specific thing that happened to this value.
  const note = error ?? statusMessage(status, value);
  const bad = !!error || statusTone(status) === 'bad';

  const save = async () => {
    // Validated here as well as disabled above: a disabled button is a hint,
    // not a guarantee, and this one writes to a unique column.
    if (!valid) {
      setError('Use 3–24 lowercase letters, numbers or underscores.');
      return;
    }
    // Known-taken never reaches the network. A check still in flight, or one
    // that failed, does — availability is reassurance and the unique index is
    // the thing that actually decides.
    if (blocksSave(status)) {
      setError('That username is already taken.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const next = await saveMyUsername(value);
      setSaved(true);
      onSaved(next);
    } catch (cause) {
      setError(describeError(cause, 'community_action'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View>
      <View style={[styles.field, bad && styles.fieldError]}>
        <Text style={styles.at}>@</Text>
        <TextInput
          value={value}
          onChangeText={next => { setValue(normalizeUsername(next)); setError(null); setSaved(false); }}
          placeholder="bella_and_sam"
          placeholderTextColor={color.slateFaint}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          maxLength={24}
          // Only where the person opened a field on purpose — see the app's
          // rule about keyboards appearing without a tap.
          autoFocus={autoFocus}
          style={styles.input}
          accessibilityLabel="Your username"
          returnKeyType="done"
          onSubmitEditing={() => { if (valid && !unchanged) void save(); }}
        />
        {/* Once it is actually saved the tick is a fact, not a forecast, so it
            outranks whatever the availability check last said. */}
        {saved && !error
          ? <Ionicons name="checkmark-circle" size={20} color={color.success} />
          : <UsernameMark status={status} />}
      </View>

      <Text
        style={[
          styles.hint,
          bad && styles.hintBad,
          !error && statusTone(status) === 'good' && styles.hintGood,
        ]}
      >
        {note ?? '3–24 lowercase letters, numbers or underscores.'}
      </Text>

      <Pressable
        onPress={() => void save()}
        disabled={saving || !valid || unchanged}
        style={({ pressed }) => [
          styles.save,
          (saving || !valid || unchanged) && styles.saveDisabled,
          pressed && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityState={{ disabled: saving || !valid || unchanged }}
      >
        {saving
          ? <BreathingPaw size={20} workingColor={color.navy} />
          : <Text style={styles.saveText}>{saveLabel}</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.hairline,
    backgroundColor: color.surface,
  },
  fieldError: { borderColor: color.error },
  at: { ...type.heading, fontSize: 18, color: color.electric },
  input: { flex: 1, minWidth: 0, minHeight: 58, ...type.bodyMedium, fontSize: 17, color: color.ink },
  hint: { ...type.caption, fontSize: 10.5, lineHeight: 15, letterSpacing: 0, color: color.slateFaint, marginTop: 8, marginHorizontal: 4 },
  // Colour only, so the line never changes height and the Save button below it
  // cannot move while somebody is reaching for it.
  hintBad: { color: color.error },
  hintGood: { color: color.success },
  save: {
    minHeight: 52,
    borderRadius: radius.lg,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.lg,
  },
  saveDisabled: { opacity: 0.45 },
  pressed: { opacity: 0.9 },
  saveText: { fontFamily: font.bold, fontSize: 14, color: color.navy },
});
