/**
 * Sign-up v2's last beat: the account exists, now save the dog.
 *
 * The auth gate sends a fresh sign-up here when a sign-up draft exists
 * (lib/signup/signupDraft.ts). This screen does what onboarding/identity does
 * after its Continue, in the same order and for the same reasons:
 *
 *   1. Claim the username first — the one thing someone else could already
 *      hold, so the one failure the owner has to act on. Failing here leaves
 *      nothing to clean up.
 *   2. Upload the photo (non-fatal; a stock image is a working pet).
 *   3. Create the pet, hydrate the active pet, clear the draft.
 *
 * A taken username gets a small recovery (pick another, or skip — it is
 * optional and Connect asks again later). Any other failure keeps the draft
 * and offers Try again; the pet id is remembered, so a retry can never create
 * a second dog. Then "Welcome, Bruno." with the walk drawing in, and Home.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Image, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { color, font, radius, signupType, space } from '../../constants/design';
import { PawtchiButton } from '../../components/PawtchiButton';
import { BreathingPaw } from '../../components/BreathingPaw';
import { SignupHeading } from '../../components/signup/SignupParts';
import { SignupRouteProgress } from '../../components/signup/SignupRouteProgress';
import { fillCopy, signupCopy } from '../../lib/signup/copy';
import { clearSignupDraft, getSignupDraft, loadSignupDraft, type SignupDraft } from '../../lib/signup/signupDraft';
import { saveMyUsername } from '../../lib/communityWalks';
import { isValidUsername, normalizeUsername } from '../../lib/communityUsername';
import { useUsernameAvailability } from '../../hooks/useUsernameAvailability';
import { blocksSave, statusMessage, statusTone } from '../../lib/community/usernameStatus';
import { currentUserId } from '../../lib/sessionUser';
import { createLightweightPet, uploadPetAvatar } from '../../lib/onboarding/petProfile';
import { useActivePetStore } from '../../store/useActivePetStore';
import { errorCopy, isUserFacingError, reportError, toAppError } from '../../lib/appError';
import { track } from '../../lib/analytics';
import { haptic } from '../../lib/haptics';

const C = signupCopy.finish;
const AnimatedPath = Animated.createAnimatedComponent(Path);
const DONE_ROUTE = 'M20 180C60 150 80 110 120 100S190 70 220 24';
const DONE_LENGTH = 300;

type Phase = 'saving' | 'username' | 'error' | 'done';

export default function SignupFinishScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();

  const [phase, setPhase] = useState<Phase>('saving');
  const [draft, setDraft] = useState<SignupDraft | null>(getSignupDraft());
  const [takenName, setTakenName] = useState('');
  const [newName, setNewName] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const usernameClaimed = useRef(false);
  const petIdRef = useRef<string | null>(null);
  const running = useRef(false);

  // Nothing behind this screen to go back to: the account exists.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  const run = useCallback(async (username: string | null) => {
    if (running.current) return;
    running.current = true;
    setPhase('saving');
    setErrorMessage(null);
    try {
      const d = getSignupDraft() ?? (await loadSignupDraft());
      if (!d) {
        // No dog to save (an old route, or storage was cleared): the classic
        // screen asks for it instead.
        router.replace('/onboarding/identity' as never);
        return;
      }
      setDraft(d);

      const wanted = username ?? d.username;
      if (wanted && !usernameClaimed.current) {
        try {
          await saveMyUsername(wanted);
          usernameClaimed.current = true;
        } catch (cause) {
          if (isUserFacingError(cause)) {
            track('signup_finish_failed', { reason: 'username_taken' });
            setTakenName(wanted);
            setNewName('');
            setPhase('username');
            haptic.warning();
            return;
          }
          throw cause;
        }
      }

      const userId = await currentUserId();
      if (!userId) throw new Error('no_session');

      if (!petIdRef.current) {
        const imageUrl = await uploadPetAvatar(userId, d.imageUri);
        const { petId, error, walksign } = await createLightweightPet({
          ownerId: userId,
          species: 'dog',
          name: d.name,
          breed: d.breed,
          ageYears: d.ageYears,
          imageUrl,
          firstDog: d.firstDog,
          householdWalkers: d.householdWalkers,
        });
        if (error || !petId) throw error ?? new Error('pet_not_created');
        petIdRef.current = petId;
        if (walksign) track('walksign_assigned', { sign: walksign, status: 'provisional', reason: 'onboarding' });
      }

      await useActivePetStore.getState().fetchPet(userId);
      await clearSignupDraft();
      track('signup_completed', {
        has_photo: !!d.imageUri,
        has_breed: !!d.breed,
        has_age: d.ageYears !== null,
        has_username: usernameClaimed.current,
      });
      haptic.success();
      setPhase('done');
    } catch (cause) {
      const appErr = toAppError(cause);
      reportError(appErr, 'pet_save');
      track('signup_finish_failed', { reason: appErr.kind });
      setErrorMessage(errorCopy(appErr, { context: 'pet_save', petName: draft?.name }).message);
      setPhase('error');
      haptic.warning();
    } finally {
      running.current = false;
    }
  }, [draft?.name, router]);

  useEffect(() => {
    void run(null);
    // Once, on arrival; retries are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── The walk drawing in on "Welcome" ─────────────────────────────────────
  const drawn = useSharedValue(0);
  useEffect(() => {
    if (phase !== 'done') return;
    drawn.value = reduceMotion
      ? 1
      : withDelay(150, withTiming(1, { duration: 1200, easing: Easing.bezier(0.45, 0, 0.2, 1) }));
  }, [drawn, phase, reduceMotion]);
  const routeProps = useAnimatedProps(() => ({ strokeDashoffset: DONE_LENGTH * (1 - drawn.value) }));

  // ── Taken username recovery ──────────────────────────────────────────────
  const normalizedNew = normalizeUsername(newName);
  const availability = useUsernameAvailability(phase === 'username' ? normalizedNew : '');
  const note = statusMessage(availability, normalizedNew);
  const canUseNew = isValidUsername(normalizedNew) && !blocksSave(availability);

  const name = draft?.name ?? '';
  const item = (i: number) => (reduceMotion ? undefined : FadeInDown.duration(320).delay(80 + i * 60));

  return (
    <View style={[styles.container, { paddingTop: insets.top + space.sm, paddingBottom: Math.max(insets.bottom, space.lg) }]}>
      <StatusBar style="dark" />
      <View style={styles.progressRow}>
        <SignupRouteProgress progress={phase === 'done' ? 1 : 0.93} />
      </View>

      {phase === 'saving' && (
        <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(220)} style={styles.center}>
          <BreathingPaw size={40} workingColor={color.navy} />
          <View style={styles.gap} />
          <SignupHeading heading={C.saving} name={name} compact />
          <Text style={styles.sub}>{C.savingSub}</Text>
        </Animated.View>
      )}

      {phase === 'username' && (
        <View style={styles.body}>
          <Animated.View entering={item(0)}>
            <SignupHeading heading={{ title: fillCopy(C.usernameTaken.title, { username: takenName }), end: '.' }} name={name} compact />
          </Animated.View>
          <Animated.Text entering={item(1)} style={styles.sub}>{C.usernameTakenSub}</Animated.Text>
          <Animated.View entering={item(2)}>
            <View style={[styles.inputRow, statusTone(availability) === 'bad' && styles.inputBad]}>
              <Text style={styles.at}>@</Text>
              <TextInput
                style={styles.inputBare}
                value={newName}
                onChangeText={v => setNewName(normalizeUsername(v))}
                placeholder={signupCopy.account.usernamePlaceholder}
                placeholderTextColor={color.slateFaint}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={24}
                accessibilityLabel={signupCopy.account.usernameLabel}
              />
            </View>
            {!!note && (
              <Text style={[styles.hint, statusTone(availability) === 'bad' && styles.hintBad]}>{note}</Text>
            )}
          </Animated.View>
          <View style={styles.flex} />
          <PawtchiButton title={C.usernameUse} variant="primary" disabled={!canUseNew} onPress={() => void run(normalizedNew)} />
          <TouchableOpacity style={styles.skip} onPress={() => void run('')} accessibilityRole="button">
            <Text style={styles.skipText}>{C.usernameSkip}</Text>
          </TouchableOpacity>
        </View>
      )}

      {phase === 'error' && (
        <View style={styles.body}>
          <Animated.View entering={item(0)}>
            <SignupHeading heading={C.failed} name={name} compact />
          </Animated.View>
          {!!errorMessage && <Animated.Text entering={item(1)} style={styles.sub}>{errorMessage}</Animated.Text>}
          <View style={styles.flex} />
          <PawtchiButton title={C.retry} variant="primary" onPress={() => void run(null)} />
        </View>
      )}

      {phase === 'done' && (
        <View style={[styles.body, styles.doneBody]}>
          <Animated.View entering={item(0)}>
            <Svg width={240} height={200} viewBox="0 0 240 200">
              <Path d="M0 60H240M0 140H240M70 0V200M170 0V200" stroke={color.cream} strokeWidth={12} />
              <AnimatedPath
                d={DONE_ROUTE}
                stroke={color.yellow}
                strokeWidth={6}
                strokeLinecap="round"
                fill="none"
                strokeDasharray={`${DONE_LENGTH} ${DONE_LENGTH}`}
                animatedProps={routeProps}
              />
              <Circle cx={120} cy={100} r={18} fill={color.electric} />
            </Svg>
            {draft?.imageUri ? (
              <Image source={{ uri: draft.imageUri }} style={styles.doneAvatar} />
            ) : (
              <View style={[styles.doneAvatar, styles.doneInitial]}>
                <Text style={styles.doneInitialText}>{name.slice(0, 1).toUpperCase()}</Text>
              </View>
            )}
          </Animated.View>
          <Animated.View entering={item(1)} style={styles.doneText}>
            <SignupHeading heading={C.welcome} name={name} />
            <Text style={[styles.sub, styles.centerText]}>{C.welcomeSub}</Text>
          </Animated.View>
          <View style={styles.flex} />
          <Animated.View entering={item(2)} style={styles.fullWidth}>
            <PawtchiButton title={C.cta} variant="primary" onPress={() => router.replace('/(tabs)' as never)} />
          </Animated.View>
        </View>
      )}
    </View>
  );
}

const AVATAR = 40;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.surface, paddingHorizontal: space.xxl },
  progressRow: { flexDirection: 'row', height: 32, alignItems: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm },
  gap: { height: space.md },
  body: { flex: 1, paddingTop: space.xxl },
  doneBody: { alignItems: 'center' },
  doneText: { alignItems: 'center', marginTop: space.lg },
  centerText: { textAlign: 'center' },
  fullWidth: { alignSelf: 'stretch' },
  flex: { flex: 1 },
  sub: { fontFamily: font.regular, fontSize: 14, lineHeight: 20, color: color.slate, marginTop: space.sm },
  doneAvatar: {
    position: 'absolute',
    left: 120 - AVATAR / 2,
    top: 100 - AVATAR / 2,
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    borderWidth: 3,
    borderColor: color.electric,
  },
  doneInitial: { backgroundColor: color.electric, alignItems: 'center', justifyContent: 'center' },
  doneInitialText: { fontFamily: font.memoryBold, fontSize: 18, color: color.yellow },
  inputRow: {
    height: 52,
    marginTop: space.lg,
    borderRadius: radius.md + 2,
    borderWidth: 1.5,
    borderColor: color.hairline,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  inputBad: { borderColor: color.error },
  inputBare: { flex: 1, height: '100%', fontFamily: font.medium, fontSize: 16, color: color.navy },
  at: { fontFamily: font.medium, fontSize: 16, color: color.slateFaint },
  hint: { ...signupType.label, letterSpacing: 0, fontFamily: font.regular, fontSize: 12, color: color.slateMuted, marginTop: 6 },
  hintBad: { color: color.error },
  skip: { height: 44, alignItems: 'center', justifyContent: 'center' },
  skipText: { fontFamily: font.medium, fontSize: 14, color: color.slateMuted },
});
