/**
 * Sign-up v2 — the dog first, one question per screen, the account last.
 *
 * Seven steps on one screen: the header (the walking-route progress bar and a
 * dog card that fills in as answers land) stays put while only the question
 * changes, which is what lets the animations read as one continuous journey.
 * Every heading takes the dog's name once it is known.
 *
 * Nothing is written until "Create account": then the dog is saved as a draft
 * (lib/signup/signupDraft.ts), the account is created, and the auth gate sends
 * the new session to onboarding/finish, which saves the username, the photo
 * and the pet. If Supabase asks for email confirmation, the existing
 * confirm-email screen sits in between and the draft waits on disk.
 *
 * Behind the `signup-v2` PostHog flag (default off); with it off, Welcome
 * still opens the classic login sign-up and onboarding/identity.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  SlideInLeft,
  SlideInRight,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { color, font, motion, radius, signupType, space } from '../../constants/design';
import { PawtchiButton } from '../../components/PawtchiButton';
import { SignupRouteProgress } from '../../components/signup/SignupRouteProgress';
import { DogCard, SignupChip, SignupHeading, SignupTile } from '../../components/signup/SignupParts';
import { supabase } from '../../lib/supabase';
import { track } from '../../lib/analytics';
import { haptic } from '../../lib/haptics';
import { errorCopy, reportError, toAppError } from '../../lib/appError';
import { clearFreshSignup, markFreshSignup } from '../../lib/onboardingFunnel';
import { prepareImageForUpload } from '../../lib/imagePrep';
import { breedsFor } from '../../constants/breeds';
import { normalizeUsername } from '../../lib/communityUsername';
import { fillCopy, signupCopy as C } from '../../lib/signup/copy';
import {
  AGE_CHOICES,
  canCreateAccount,
  dogNameOrFallback,
  isValidEmail,
  OPTIONAL_STEPS,
  PASSWORD_MIN,
  POPULAR_BREEDS,
  passwordStrength,
  SIGNUP_STEPS,
  signupProgress,
  signupStepIndex,
  usernameFormat,
  type SignupStepId,
} from '../../lib/signup/signupFlow';
import { clearSignupDraft, saveSignupDraft } from '../../lib/signup/signupDraft';
import { useUsernameAvailability } from '../../hooks/useUsernameAvailability';
import { blocksSave, statusMessage, statusTone } from '../../lib/community/usernameStatus';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const RING = 150;
const RING_R = 71;
const RING_C = 2 * Math.PI * RING_R;
/** A binary answer moves on by itself after this beat. */
const AUTO_ADVANCE_MS = 320;

export default function SignupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();

  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const step: SignupStepId = SIGNUP_STEPS[stepIndex];

  const [name, setName] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [breed, setBreed] = useState<string | null>(null);
  const [breedQuery, setBreedQuery] = useState('');
  const [ageLabel, setAgeLabel] = useState<string | null>(null);
  const [firstDog, setFirstDog] = useState<boolean | null>(null);
  const [walkers, setWalkers] = useState<number | null>(null);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dogName = name.trim();
  const shownName = dogNameOrFallback(name);

  // ── Analytics: one view per step, in order ───────────────────────────────
  useEffect(() => {
    track('signup_step_viewed', {
      step,
      step_index: signupStepIndex(step),
      total: SIGNUP_STEPS.length,
    });
  }, [step]);

  useEffect(() => () => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
  }, []);

  const goTo = useCallback((next: number) => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    setDirection(next > stepIndex ? 1 : -1);
    setFormError(null);
    setStepIndex(Math.max(0, Math.min(SIGNUP_STEPS.length - 1, next)));
  }, [stepIndex]);

  const complete = useCallback((props: Record<string, string | number | boolean | null> = {}) => {
    track('signup_step_completed', { step, step_index: signupStepIndex(step), ...props });
    haptic.select();
    goTo(stepIndex + 1);
  }, [goTo, step, stepIndex]);

  const skip = useCallback(() => {
    track('signup_step_skipped', { step, step_index: signupStepIndex(step) });
    goTo(stepIndex + 1);
  }, [goTo, step, stepIndex]);

  const back = useCallback(() => {
    if (submitting) return true;
    track('signup_back', { step, step_index: signupStepIndex(step) });
    if (stepIndex === 0) {
      router.back();
      return true;
    }
    goTo(stepIndex - 1);
    return true;
  }, [goTo, router, step, stepIndex, submitting]);

  // Android's back button steps back through the questions, not out of them.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', back);
    return () => sub.remove();
  }, [back]);

  const autoAdvance = useCallback(() => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(() => complete(), AUTO_ADVANCE_MS);
  }, [complete]);

  // ── The dog card's tags ──────────────────────────────────────────────────
  const tags = useMemo(() => {
    const out: string[] = [];
    if (breed) out.push(breed);
    if (ageLabel) out.push(ageLabel === 'Puppy' ? 'Puppy' : `${ageLabel} yrs`);
    if (firstDog !== null) out.push(firstDog ? 'First dog' : 'Not my first');
    if (walkers !== null) out.push(walkers >= 3 ? '3+ walkers' : '1–2 walkers');
    return out;
  }, [ageLabel, breed, firstDog, walkers]);

  // ── Photo: pick, prepare, and let it arrive with a ring ──────────────────
  const ring = useSharedValue(0);
  const pop = useSharedValue(1);
  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: RING_C * (1 - ring.value) }));
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  const pickPhoto = async () => {
    track('ui_button_tapped', { button_name: 'pick_avatar', screen: 'signup' });
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.length) return;
    const prepared = await prepareImageForUpload(result.assets[0]);
    setImageUri(prepared.uri);
    haptic.success();
    if (reduceMotion) {
      ring.value = 1;
      return;
    }
    ring.value = 0;
    ring.value = withTiming(1, { duration: motion.duration.ring, easing: Easing.out(Easing.cubic) });
    pop.value = withSequence(withSpring(1.06, motion.spring.bouncy), withSpring(1, motion.spring.gentle));
  };

  // ── Breed search ─────────────────────────────────────────────────────────
  const breedOptions = useMemo(() => {
    const q = breedQuery.trim().toLowerCase();
    if (!q) return [...POPULAR_BREEDS];
    return breedsFor('dog').filter(b => b.toLowerCase().includes(q)).slice(0, 8);
  }, [breedQuery]);
  const typedBreed = breedQuery.trim();
  const showTypedBreed =
    typedBreed.length > 1 && !breedsFor('dog').some(b => b.toLowerCase() === typedBreed.toLowerCase());

  // ── Account ──────────────────────────────────────────────────────────────
  const userFormat = usernameFormat(username);
  // The same live check the old identity screen had (debounced, stale answers
  // dropped), asked through the anon-callable RPC because nobody is signed in
  // yet. "Unknown" never blocks; only a definite "taken" does.
  const usernameStatus = useUsernameAvailability(username, null, 'signup');
  const usernameTaken = userFormat === 'ok' && blocksSave(usernameStatus);
  const usernameTone = userFormat === 'bad' ? 'bad' : statusTone(usernameStatus);
  const usernameNote =
    userFormat === 'bad'
      ? C.account.usernameError
      : statusMessage(usernameStatus, username) ?? C.account.usernameHint;
  const strength = passwordStrength(password);
  const canCreate = canCreateAccount({ email, password, username }) && !usernameTaken;

  const createAccount = async () => {
    if (submitting) return;
    if (!canCreate) {
      setFormError(
        usernameTaken
          ? C.account.usernameTaken
          : !isValidEmail(email)
            ? 'Check your email address.'
            : password.length < PASSWORD_MIN
              ? `Use at least ${PASSWORD_MIN} characters for your password.`
              : C.account.usernameError,
      );
      haptic.warning();
      return;
    }
    setFormError(null);
    setSubmitting(true);

    const ageYears = AGE_CHOICES.find(a => a.label === ageLabel)?.years ?? null;
    await saveSignupDraft({
      name: dogName,
      imageUri,
      breed,
      ageYears,
      firstDog,
      householdWalkers: walkers,
      username: normalizeUsername(username),
    });
    track('signup_account_submitted', {
      has_photo: !!imageUri,
      has_breed: !!breed,
      has_age: ageYears !== null,
      has_username: userFormat === 'ok',
    });

    // Marked BEFORE the call, as in login.tsx: the session event and the auth
    // gate's navigation can land before this await resumes.
    markFreshSignup();
    const trimmedEmail = email.trim();
    const { data, error } = await supabase.auth.signUp({
      email: trimmedEmail,
      password,
      options: { data: { full_name: trimmedEmail.split('@')[0] } },
    });

    if (error) {
      clearFreshSignup();
      await clearSignupDraft();
      setSubmitting(false);
      const appErr = toAppError(error);
      reportError(appErr, 'auth');
      track('signup_account_failed', { reason: appErr.detailKey ?? appErr.kind });
      setFormError(errorCopy(appErr, { context: 'auth' }).message);
      haptic.warning();
      return;
    }
    track('signup_step_completed', { step: 'account', step_index: signupStepIndex('account') });
    if (data.session === null) {
      // Email confirmation is on: the draft waits on disk, and confirm-email
      // re-warms it before verifying.
      clearFreshSignup();
      setSubmitting(false);
      router.push({ pathname: '/(auth)/confirm-email', params: { email: trimmedEmail } } as never);
      return;
    }
    haptic.success();
    // The auth gate takes it from here: fresh sign-up + draft → onboarding/finish.
  };

  // ── Layout ───────────────────────────────────────────────────────────────
  const entering = reduceMotion
    ? FadeIn.duration(180)
    : (direction === 1 ? SlideInRight : SlideInLeft).duration(320).easing(Easing.bezier(0.23, 1, 0.32, 1));
  const exiting = FadeOut.duration(140);
  const item = (i: number) => (reduceMotion ? undefined : FadeInDown.duration(320).delay(60 + i * 50));

  const body = (() => {
    switch (step) {
      case 'name':
        return (
          <>
            <Animated.View entering={item(0)}>
              <SignupHeading heading={C.name.heading} name={name} />
            </Animated.View>
            <Animated.Text entering={item(1)} style={styles.sub}>{C.name.sub}</Animated.Text>
            <Animated.View entering={item(2)}>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder={C.name.placeholder}
                placeholderTextColor={color.slateFaint}
                autoCapitalize="words"
                autoCorrect={false}
                maxLength={30}
                returnKeyType="next"
                onSubmitEditing={() => dogName && complete()}
                accessibilityLabel="Dog's name"
              />
            </Animated.View>
          </>
        );
      case 'photo':
        return (
          <>
            <Animated.View entering={item(0)}>
              <SignupHeading heading={C.photo.heading} name={name} />
            </Animated.View>
            <Animated.Text entering={item(1)} style={styles.sub}>
              {fillCopy(C.photo.sub, { name: shownName })}
            </Animated.Text>
            <Animated.View entering={item(2)} style={styles.photoWrap}>
              <Pressable
                onPress={pickPhoto}
                accessibilityRole="button"
                accessibilityLabel={imageUri ? C.photo.change : C.photo.add}
              >
                <Animated.View style={[styles.photoCircle, popStyle]}>
                  {imageUri ? (
                    <Image source={{ uri: imageUri }} style={styles.photoImg} />
                  ) : (
                    <View style={styles.photoEmpty}>
                      <MaterialIcons name="add-a-photo" size={34} color={color.slateFaint} />
                      <Text style={styles.photoHint}>{C.photo.add}</Text>
                    </View>
                  )}
                </Animated.View>
                <Svg width={RING} height={RING} style={styles.ring} pointerEvents="none">
                  <AnimatedCircle
                    cx={RING / 2}
                    cy={RING / 2}
                    r={RING_R}
                    stroke={color.yellow}
                    strokeWidth={4}
                    strokeLinecap="round"
                    fill="none"
                    strokeDasharray={`${RING_C}`}
                    animatedProps={ringProps}
                    transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
                  />
                </Svg>
              </Pressable>
            </Animated.View>
          </>
        );
      case 'breed':
        return (
          <>
            <Animated.View entering={item(0)}>
              <SignupHeading heading={C.breed.heading} name={name} />
            </Animated.View>
            <Animated.Text entering={item(1)} style={styles.sub}>
              {fillCopy(C.breed.sub, { name: shownName })}
            </Animated.Text>
            <Animated.View entering={item(2)} style={styles.searchWrap}>
              <MaterialIcons name="search" size={18} color={color.slateFaint} />
              <TextInput
                style={styles.searchInput}
                value={breedQuery}
                onChangeText={setBreedQuery}
                placeholder={C.breed.search}
                placeholderTextColor={color.slateFaint}
                autoCorrect={false}
                accessibilityLabel={C.breed.search}
              />
            </Animated.View>
            <Animated.View entering={item(3)} style={styles.chips}>
              {breedOptions.map(b => (
                <SignupChip key={b} label={b} selected={breed === b} onPress={() => { setBreed(b); haptic.select(); }} />
              ))}
              {showTypedBreed && (
                <SignupChip
                  label={fillCopy(C.breed.useTyped, { query: typedBreed })}
                  selected={breed === typedBreed}
                  onPress={() => { setBreed(typedBreed); haptic.select(); }}
                />
              )}
            </Animated.View>
          </>
        );
      case 'age':
        return (
          <>
            <Animated.View entering={item(0)}>
              <SignupHeading heading={C.age.heading} name={name} />
            </Animated.View>
            <Animated.Text entering={item(1)} style={styles.sub}>{C.age.sub}</Animated.Text>
            <Animated.View entering={item(2)} style={styles.chips}>
              {AGE_CHOICES.map(a => (
                <SignupChip
                  key={a.label}
                  label={a.label}
                  selected={ageLabel === a.label}
                  onPress={() => { setAgeLabel(a.label); haptic.select(); }}
                />
              ))}
            </Animated.View>
          </>
        );
      case 'first_dog':
        return (
          <>
            <Animated.View entering={item(0)}>
              <SignupHeading heading={C.firstDog.heading} name={name} />
            </Animated.View>
            <Animated.Text entering={item(1)} style={styles.sub}>{C.firstDog.sub}</Animated.Text>
            <Animated.View entering={item(2)} style={styles.tiles}>
              <SignupTile
                label={C.firstDog.yes}
                caption={C.firstDog.yesCaption}
                icon="star-four-points-outline"
                selected={firstDog === true}
                onPress={() => { setFirstDog(true); autoAdvance(); }}
              />
              <SignupTile
                label={C.firstDog.no}
                caption={C.firstDog.noCaption}
                icon="heart-multiple-outline"
                selected={firstDog === false}
                onPress={() => { setFirstDog(false); autoAdvance(); }}
              />
            </Animated.View>
          </>
        );
      case 'walkers':
        return (
          <>
            <Animated.View entering={item(0)}>
              <SignupHeading heading={C.walkers.heading} name={name} />
            </Animated.View>
            <Animated.Text entering={item(1)} style={styles.sub}>
              {fillCopy(C.walkers.sub, { name: shownName })}
            </Animated.Text>
            <Animated.View entering={item(2)} style={styles.tiles}>
              <SignupTile
                label={C.walkers.few}
                caption={C.walkers.fewCaption}
                icon="account-multiple-outline"
                selected={walkers === 1}
                onPress={() => { setWalkers(1); autoAdvance(); }}
              />
              <SignupTile
                label={C.walkers.many}
                caption={C.walkers.manyCaption}
                icon="account-group-outline"
                selected={walkers === 3}
                onPress={() => { setWalkers(3); autoAdvance(); }}
              />
            </Animated.View>
          </>
        );
      case 'account':
        return (
          <>
            <Animated.View entering={item(0)}>
              <SignupHeading heading={C.account.heading} name={name} compact />
            </Animated.View>
            <Animated.View entering={item(1)}>
              <Text style={styles.label}>
                {C.account.usernameLabel.toUpperCase()}
                <Text style={styles.labelOptional}>{`  ·  ${C.account.optional}`}</Text>
              </Text>
              <View
                style={[
                  styles.inputRow,
                  usernameTone === 'bad' && styles.inputBad,
                  usernameTone === 'good' && styles.inputGood,
                ]}
              >
                <Text style={styles.at}>@</Text>
                <TextInput
                  style={styles.inputBare}
                  value={username}
                  onChangeText={v => { setUsername(normalizeUsername(v)); setFormError(null); }}
                  placeholder={C.account.usernamePlaceholder}
                  placeholderTextColor={color.slateFaint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={24}
                  accessibilityLabel={C.account.usernameLabel}
                />
              </View>
              <Text
                style={[
                  styles.hint,
                  usernameTone === 'bad' && styles.hintBad,
                  usernameTone === 'good' && styles.hintGood,
                ]}
              >
                {usernameNote}
              </Text>
            </Animated.View>
            <Animated.View entering={item(2)}>
              <Text style={styles.label}>{C.account.emailLabel.toUpperCase()}</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={v => { setEmail(v); setFormError(null); }}
                placeholder={C.account.emailPlaceholder}
                placeholderTextColor={color.slateFaint}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                autoComplete="email"
                accessibilityLabel={C.account.emailLabel}
              />
            </Animated.View>
            <Animated.View entering={item(3)}>
              <Text style={styles.label}>{C.account.passwordLabel.toUpperCase()}</Text>
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.inputBare}
                  value={password}
                  onChangeText={v => { setPassword(v); setFormError(null); }}
                  placeholder={C.account.passwordPlaceholder}
                  placeholderTextColor={color.slateFaint}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="newPassword"
                  autoComplete="password-new"
                  accessibilityLabel={C.account.passwordLabel}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(v => !v)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityLabel={showPassword ? C.account.hidePassword : C.account.showPassword}
                >
                  <MaterialIcons name={showPassword ? 'visibility-off' : 'visibility'} size={20} color={color.slateFaint} />
                </TouchableOpacity>
              </View>
              <View style={styles.strengthTrack}>
                <View
                  style={[
                    styles.strengthFill,
                    {
                      width: `${Math.round(strength * 100)}%`,
                      backgroundColor: password.length >= PASSWORD_MIN ? color.success : color.yellow,
                    },
                  ]}
                />
              </View>
            </Animated.View>
            {formError && (
              <View style={styles.errorRow}>
                <MaterialIcons name="error-outline" size={15} color={color.error} />
                <Text style={styles.errorText}>{formError}</Text>
              </View>
            )}
          </>
        );
    }
  })();

  const footer = (() => {
    if (step === 'name') {
      return <PawtchiButton title={C.name.cta} variant="primary" disabled={!dogName} onPress={() => complete()} />;
    }
    if (step === 'account') {
      return (
        <>
          <PawtchiButton title={C.account.cta} variant="primary" loading={submitting} onPress={createAccount} />
          {/* APP 5 / IPP 3: the collection notice before the account exists. */}
          <Text style={styles.notice}>
            {C.account.noticeLead}{' '}
            <Text style={styles.noticeLink} onPress={() => router.push('/privacy' as never)}>{C.account.privacy}</Text>
            {` ${C.account.and} `}
            <Text style={styles.noticeLink} onPress={() => Linking.openURL('https://pawtchi.com/terms')}>{C.account.terms}</Text>
            .
          </Text>
          <View style={styles.signInRow}>
            <Text style={styles.signInText}>{C.account.haveAccount}</Text>
            <TouchableOpacity
              disabled={submitting}
              onPress={() => router.replace({ pathname: '/(auth)/login', params: { mode: 'signin' } } as never)}
            >
              <Text style={styles.signInLink}>{C.account.signIn}</Text>
            </TouchableOpacity>
          </View>
        </>
      );
    }
    const skipLabel =
      step === 'photo' ? C.photo.skip
        : step === 'breed' ? C.breed.skip
          : step === 'age' ? C.age.skip
            : step === 'first_dog' ? C.firstDog.skip
              : C.walkers.skip;
    const hasNext = step === 'photo' || step === 'breed' || step === 'age';
    const answered =
      (step === 'photo' && !!imageUri) || (step === 'breed' && !!breed) || (step === 'age' && !!ageLabel);
    return (
      <>
        {hasNext && (
          <PawtchiButton
            title={C.photo.cta}
            variant="primary"
            onPress={() => (answered ? complete({ answered: true }) : skip())}
          />
        )}
        {OPTIONAL_STEPS.has(step) && (
          <TouchableOpacity style={styles.skip} onPress={skip} accessibilityRole="button">
            <Text style={styles.skipText}>{skipLabel}</Text>
          </TouchableOpacity>
        )}
      </>
    );
  })();

  return (
    <View style={[styles.container, { paddingTop: insets.top + space.sm }]}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={back}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel={C.back}
          >
            <MaterialIcons name="arrow-back" size={22} color={color.navy} />
          </TouchableOpacity>
          <SignupRouteProgress progress={signupProgress(stepIndex)} />
        </View>
        {dogName ? (
          <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(260)} style={styles.cardWrap}>
            <DogCard name={dogName} imageUri={imageUri} tags={tags} />
          </Animated.View>
        ) : (
          <View style={styles.cardSpacer} />
        )}
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          bounces={false}
          showsVerticalScrollIndicator={false}
        >
          {/* Questions sit in the middle of the free space, a little above
              centre, so a short step does not leave a dead band above the
              footer. The account step is long and meets the keyboard, so it
              stays top-aligned. */}
          <Animated.View
            key={step}
            entering={entering}
            exiting={exiting}
            style={[styles.body, step !== 'account' && styles.bodyCentered]}
          >
            {body}
          </Animated.View>
          {step === 'account' && <View style={styles.flex} />}
          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>{footer}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.surface },
  flex: { flex: 1 },
  header: { paddingHorizontal: space.xxl },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, height: 32 },
  cardWrap: { marginTop: space.md },
  cardSpacer: { height: 44 + space.md },
  scroll: { flexGrow: 1, paddingHorizontal: space.xxl },
  body: { paddingTop: space.xl },
  bodyCentered: { flex: 1, justifyContent: 'center', paddingTop: 0, paddingBottom: space.xxxl * 2 },
  sub: { fontFamily: font.regular, fontSize: 14, lineHeight: 20, color: color.slate, marginTop: space.sm, marginBottom: space.lg },
  input: {
    height: 52,
    borderRadius: radius.md + 2,
    borderWidth: 1.5,
    borderColor: color.hairline,
    paddingHorizontal: space.lg,
    fontFamily: font.medium,
    fontSize: 16,
    color: color.navy,
    backgroundColor: color.surface,
  },
  inputRow: {
    height: 52,
    borderRadius: radius.md + 2,
    borderWidth: 1.5,
    borderColor: color.hairline,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: color.surface,
  },
  inputBad: { borderColor: color.error },
  inputGood: { borderColor: color.success },
  inputBare: { flex: 1, height: '100%', fontFamily: font.medium, fontSize: 16, color: color.navy },
  at: { fontFamily: font.medium, fontSize: 16, color: color.slateFaint },
  label: { ...signupType.label, color: color.slate, marginTop: space.lg, marginBottom: space.sm },
  labelOptional: { fontFamily: font.regular, letterSpacing: 0, color: color.slateFaint },
  hint: { fontFamily: font.regular, fontSize: 12, color: color.slateMuted, marginTop: 6 },
  hintBad: { color: color.error },
  hintGood: { color: color.success },
  strengthTrack: { height: 4, borderRadius: 2, backgroundColor: color.track, marginTop: space.sm, overflow: 'hidden' },
  strengthFill: { height: '100%', borderRadius: 2 },
  photoWrap: { alignItems: 'center', marginTop: space.md },
  photoCircle: {
    width: RING - 16,
    height: RING - 16,
    margin: 8,
    borderRadius: radius.pill,
    backgroundColor: color.cream,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoImg: { width: '100%', height: '100%' },
  photoEmpty: { alignItems: 'center', gap: 6 },
  photoHint: { fontFamily: font.medium, fontSize: 13, color: color.slateMuted },
  ring: { position: 'absolute', top: 0, left: 0 },
  searchWrap: {
    height: 48,
    borderRadius: radius.md + 2,
    borderWidth: 1.5,
    borderColor: color.hairline,
    paddingHorizontal: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginBottom: space.md,
  },
  searchInput: { flex: 1, height: '100%', fontFamily: font.medium, fontSize: 15, color: color.navy },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tiles: { flexDirection: 'row', gap: space.md },
  footer: { paddingTop: space.lg, gap: space.xs },
  skip: { height: 44, alignItems: 'center', justifyContent: 'center' },
  skipText: { fontFamily: font.medium, fontSize: 14, color: color.slateMuted },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.md },
  errorText: { flex: 1, fontFamily: font.medium, fontSize: 13, color: color.error },
  notice: {
    fontFamily: font.regular,
    fontSize: 11.5,
    lineHeight: 16,
    color: color.slateMuted,
    textAlign: 'center',
    marginTop: space.sm,
  },
  noticeLink: { fontFamily: font.semibold, color: color.navy, textDecorationLine: 'underline' },
  signInRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: space.sm },
  signInText: { fontFamily: font.regular, fontSize: 13, color: color.slateMuted },
  signInLink: { fontFamily: font.semibold, fontSize: 13, color: color.navy },
});
