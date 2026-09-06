/**
 * The $9.99 paywall. This is the screen that has been shipping — moved here
 * unchanged when app/paywall.tsx became a two-presentation selector.
 *
 * Two things were added in the move, both additive:
 *
 *  1. `variant: 'standard'` on every paywall_* event. The win-back screen sends
 *     `variant: 'winback'` on the same event names, so the funnel stays whole
 *     and existing dashboards keep working. Renaming these to `primary_*` and
 *     forking the funnel was the alternative, and it would have orphaned every
 *     chart already built on paywall_viewed.
 *
 *  2. `recordPaywallInteraction()` beside three of the track() calls. These are
 *     the counters the eligibility rules read. They are fire-and-forget: a
 *     failed counter costs one signal, a thrown error costs a sale.
 *
 * Nothing else about this screen's behaviour changed.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Alert,
    Linking,
    Image,
    Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
import Animated, {
    FadeInDown,
    FadeIn,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withSequence,
    withTiming,
    Easing,
    cancelAnimation,
} from 'react-native-reanimated';
import Purchases, { PurchasesPackage } from 'react-native-purchases';
import Constants from 'expo-constants';
import { color, makeShadow } from '../../constants/design';
import { PawLoader } from '../loader/PawLoader';
import { useActivePetStore } from '../../store/useActivePetStore';
import { useSubscription } from '../../hooks/useSubscription';
import { track } from '../../lib/analytics';
import { recordPaywallInteraction } from '../../lib/proOffer/client';
import { openManageSubscription } from '../../lib/manageSubscription';
import { promoPaywallBody } from '../../lib/creatorCode/copy';
import { BILLING_HELP_LABEL } from '../../lib/support/copy';
import { FailureModal } from '../FailureModal';
import { errorCopy, reportError, toAppError, type ErrorCopy, type RecoveryActionId } from '../../lib/appError';
import {
    NAVY,
    YELLOW,
    GRAY_500,
    GRAY_400,
    CHIP_BG,
    CHIP_BORDER,
    TESTIMONIAL_BG,
    TESTIMONIAL_BORDER,
    DISPLAY,
    BODY,
    BODY_MED,
    BODY_SEMI,
    BODY_BOLD,
    BODY_XB,
} from './theme';
import { ArrowIcon, BrandMark, CloseIcon, StarIcon, FEATURE_CHIPS } from './icons';

const { height: SCREEN_H } = Dimensions.get('window');
const HERO_HEIGHT = SCREEN_H * 0.48;

const OFFERINGS_TIMEOUT_MS = 8000;

const IS_EXPO_GO =
    Constants.appOwnership === 'expo' ||
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Constants as any).executionEnvironment === 'storeClient';
const USE_MOCK_PLANS = __DEV__ && IS_EXPO_GO;

const MOCK_PACKAGES = [
    {
        identifier: 'annual', packageType: 'ANNUAL',
        product: {
            priceString: 'A$79.00', price: 79, currencyCode: 'AUD',
            pricePerMonth: 6.58, pricePerMonthString: 'A$6.58',
            pricePerWeek: 1.52, pricePerWeekString: 'A$1.52',
            introPrice: null, subscriptionOptions: [],
            defaultOption: { freePhase: { billingPeriod: { unit: 'MONTH', value: 1, iso8601: 'P1M' } } },
        },
    },
    {
        identifier: 'monthly', packageType: 'MONTHLY',
        product: {
            priceString: 'A$9.99', price: 9.99, currencyCode: 'AUD',
            pricePerMonth: 9.99, pricePerMonthString: 'A$9.99',
            pricePerWeek: 2.31, pricePerWeekString: 'A$2.31',
            introPrice: null, subscriptionOptions: [],
            defaultOption: { freePhase: { billingPeriod: { unit: 'MONTH', value: 1, iso8601: 'P1M' } } },
        },
    },
] as unknown as PurchasesPackage[];

type PaywallMode = 'welcome' | 'upgrade' | 'renewal';
type LoadState = 'loading' | 'loaded' | 'error';

function deriveMode(status: string, isFreemiumActive: boolean, daysSinceCreation: number): PaywallMode {
    if (daysSinceCreation <= 1 && (status === 'none' || status === 'loading')) return 'welcome';
    if (isFreemiumActive && status !== 'expired') return 'upgrade';
    return 'renewal';
}

// ─── Mosaic images ───
const MOSAIC = {
    topLeft: require('../../assets/images/paywall/scan-food.png'),
    center: require('../../assets/images/paywall/hero-center.png'),
    topRight: require('../../assets/images/paywall/cat-play.png'),
    bottomLeft: require('../../assets/images/paywall/hiking-dog.png'),
    bottomRight: require('../../assets/images/paywall/park-puppy.png'),
};

// ─── Pricing helpers ───

function capitalize(s: string): string {
    return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

function periodPhrase(unit?: string | null, value?: number | null, iso?: string | null): string | null {
    let u = unit ? String(unit).toUpperCase() : null;
    let v = value ?? null;
    if ((!u || !v) && iso) {
        const m = String(iso).toUpperCase().match(/P(\d+)([DWMY])/);
        if (m) {
            v = parseInt(m[1], 10);
            u = ({ D: 'DAY', W: 'WEEK', M: 'MONTH', Y: 'YEAR' } as Record<string, string>)[m[2]];
        }
    }
    if (!u || !v) return null;
    const noun = u.startsWith('DAY') ? 'day' : u.startsWith('WEEK') ? 'week' : u.startsWith('MONTH') ? 'month' : u.startsWith('YEAR') ? 'year' : null;
    return noun ? `${v}-${noun}` : null;
}

/** True when a pricing phase is a free trial — RC's `freePhase` accessor is
 *  "first phase where amountMicros == 0", but we also accept a zero `price`
 *  or `paymentMode: FREE_TRIAL` in case the SDK build returns a different
 *  shape (older RC builds, in-migration types). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function phaseIsFree(phase: any): boolean {
    if (!phase) return false;
    if (phase.offerPaymentMode === 'FREE_TRIAL') return true;
    const price = phase.price;
    if (!price) return false;
    if (Number(price.amountMicros) === 0) return true;
    if (Number(price.amount) === 0) return true;
    // Some builds surface the phase price as a flat number.
    if (typeof price === 'number' && price === 0) return true;
    return false;
}

/** Any option under this product that carries a free trial phase, walking
 *  ALL subscriptionOptions rather than trusting `defaultOption` alone —
 *  RevenueCat can pick the base plan as default even when a trial offer
 *  exists elsewhere on the SKU. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findFreePhase(product: any): any | null {
    const opts: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (product?.defaultOption) opts.push(product.defaultOption);
    if (Array.isArray(product?.subscriptionOptions)) opts.push(...product.subscriptionOptions);
    for (const opt of opts) {
        if (!opt) continue;
        // Convenience accessor first (RC v7+): it's the "first phase where
        // amountMicros === 0" and cheapest to check.
        if (opt.freePhase?.billingPeriod) return opt.freePhase;
        // Fallback: walk pricing phases directly. An offer can carry both a
        // free trial and a paid intro on the same option, so we need the
        // free one specifically, not just phase[0].
        const phases = Array.isArray(opt.pricingPhases) ? opt.pricingPhases : [];
        const free = phases.find(phaseIsFree);
        if (free?.billingPeriod) return free;
    }
    return null;
}

function getTrialPhrase(pkg?: PurchasesPackage): string | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p: any = pkg?.product;
    if (!p) return null;

    // iOS surfaces the free trial as `introPrice` with price 0 (or the
    // formatted string "Free"; some regions/locales return "0.00" as a
    // string, so we don't rely on strict equality).
    const intro = p.introPrice;
    if (intro) {
        const looksFree =
            Number(intro.price) === 0 ||
            String(intro.priceString ?? '').trim().toLowerCase() === 'free';
        if (looksFree) {
            const ph = periodPhrase(intro.periodUnit, intro.periodNumberOfUnits, intro.period);
            if (ph) return `${ph} free trial`;
        }
    }

    // Android: any subscription option that carries a free-trial phase.
    const free = findFreePhase(p);
    const bp = free?.billingPeriod;
    if (bp) {
        const ph = periodPhrase(bp.unit, bp.value, bp.iso8601);
        if (ph) return `${ph} free`;
    }
    return null;
}

/** __DEV__ only: log what shape the store returned when a trial we expected
 *  didn't parse. Copy this out of a device console and share it if the paywall
 *  still says "Subscribe" instead of "Start Free Trial" in a real build. */
function debugLogMissingTrial(pkg: PurchasesPackage | undefined) {
    if (!__DEV__ || !pkg) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p: any = pkg.product;
    // eslint-disable-next-line no-console
    console.log('[paywall] no trial parsed for', pkg.identifier, {
        introPrice: p?.introPrice ?? null,
        defaultOption: p?.defaultOption
            ? {
                  id: p.defaultOption.id,
                  isBasePlan: p.defaultOption.isBasePlan,
                  freePhase: p.defaultOption.freePhase ?? null,
                  pricingPhaseCount: Array.isArray(p.defaultOption.pricingPhases)
                      ? p.defaultOption.pricingPhases.length
                      : 0,
              }
            : null,
        subscriptionOptions: Array.isArray(p?.subscriptionOptions)
            ? p.subscriptionOptions.map((o: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
                  id: o?.id,
                  isBasePlan: o?.isBasePlan,
                  freePhase: o?.freePhase ?? null,
                  phaseModes: Array.isArray(o?.pricingPhases)
                      ? o.pricingPhases.map((ph: any) => ph?.offerPaymentMode ?? null) // eslint-disable-line @typescript-eslint/no-explicit-any
                      : [],
              }))
            : null,
    });
}

// ─── Pulse glow animation for CTA ───
function PulseGlowCTA({ label, onPress, disabled }: {
    label: string;
    onPress: () => void;
    disabled: boolean;
}) {
    const glowScale = useSharedValue(1);

    useEffect(() => {
        glowScale.value = withRepeat(
            withSequence(
                withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
                withTiming(1.02, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
            ),
            -1,
            true,
        );
        return () => cancelAnimation(glowScale);
    }, [glowScale]);

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ scale: glowScale.value }],
    }));

    return (
        <TouchableOpacity
            onPress={onPress}
            disabled={disabled}
            activeOpacity={0.9}
            style={{ width: '100%' }}
        >
            <Animated.View style={[styles.cta, animatedStyle, disabled && styles.ctaDisabled]}>
                <View style={styles.ctaInner}>
                    <Text style={styles.ctaText}>{label}</Text>
                    <ArrowIcon />
                </View>
            </Animated.View>
        </TouchableOpacity>
    );
}

export function StandardPaywall() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const activePet = useActivePetStore(s => s.activePet);
    const {
        restorePurchases, purchasePackage, getOfferings, status, isPro,
        isFreemiumActive, daysSinceCreation, isPromoAccess, expiresAt,
    } = useSubscription();

    const [purchasing, setPurchasing] = useState(false);
    const [packages, setPackages] = useState<PurchasesPackage[]>([]);
    const [loadState, setLoadState] = useState<LoadState>('loading');
    const [isConfigured, setIsConfigured] = useState<boolean | null>(null);
    // Branded failure sheet — the purchase paths land here instead of a raw alert.
    const [failure, setFailure] = useState<ErrorCopy | null>(null);
    // What a "Try again" on the failure sheet should replay — reload offerings
    // when plans didn't load, re-run the purchase when the charge failed.
    const retryRef = useRef<null | (() => void)>(null);
    // Only the action this screen owns — FailureModal handles contact support,
    // settings and back, so none of them can go dead here.
    const handleRecovery = (action: RecoveryActionId) => {
        if (action === 'retry') retryRef.current?.();
    };

    const petName = activePet?.name?.trim() || null;
    const petPossessive = petName ? `${petName}'s` : "your pet's";

    const mode = deriveMode(status, isFreemiumActive, daysSinceCreation);

    // Set only when access was GRANTED and we know when it ends. Both halves
    // matter: without a date there is nothing honest to put on the screen, so
    // the ordinary paid copy is the safer fallback.
    const grantedUntil = isPromoAccess && expiresAt ? expiresAt : null;

    // A dismissal inside the 30-day freemium window is not a refusal — nothing
    // was being withheld. The eligibility rules count the two separately, and
    // this is where that distinction is made, because SubscriptionProvider
    // already owns the answer.
    const postFreemium = !isFreemiumActive;

    // ─── Offerings load ───
    const loadOfferings = useCallback(async () => {
        setLoadState('loading');
        try {
            const pkgs = await Promise.race([
                getOfferings(),
                new Promise<PurchasesPackage[]>((_, reject) =>
                    setTimeout(() => reject(new Error('offerings_timeout')), OFFERINGS_TIMEOUT_MS),
                ),
            ]);
            if (pkgs && pkgs.length > 0) {
                setPackages(pkgs);
                setLoadState('loaded');
            } else if (USE_MOCK_PLANS) {
                setPackages(MOCK_PACKAGES);
                setLoadState('loaded');
            } else {
                setPackages([]);
                setLoadState('error');
                track('paywall_offerings_error', { reason: 'empty', variant: 'standard' });
            }
        } catch (e: unknown) {
            if (USE_MOCK_PLANS) {
                setPackages(MOCK_PACKAGES);
                setLoadState('loaded');
            } else {
                setPackages([]);
                setLoadState('error');
                track('paywall_offerings_error', {
                    reason: e instanceof Error ? e.message : 'exception',
                    variant: 'standard',
                });
            }
        }
    }, [getOfferings]);

    useEffect(() => { loadOfferings(); }, [loadOfferings]);

    useEffect(() => {
        track('paywall_viewed', { mode, variant: 'standard' });
        recordPaywallInteraction('view', postFreemium);
        (async () => {
            try {
                setIsConfigured(await Purchases.isConfigured());
            } catch {
                setIsConfigured(false);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleRetry = () => {
        track('paywall_offerings_retried', { variant: 'standard' });
        loadOfferings();
    };

    const loaded = loadState === 'loaded';
    const monthlyPkg = packages.find((p) => p.packageType === 'MONTHLY');
    const selectedPkg = monthlyPkg || packages[0];
    const selectedPrice = selectedPkg?.product.priceString ?? '';
    const periodWord = 'month';
    const trialPhrase = getTrialPhrase(selectedPkg);
    // If we shipped the offering expecting a trial and it didn't parse, dump
    // the raw shape so a device console log tells us why in a real build.
    useEffect(() => {
        if (loaded && selectedPkg && !trialPhrase) debugLogMissingTrial(selectedPkg);
    }, [loaded, selectedPkg, trialPhrase]);

    const handlePurchase = async () => {
        if (isPro) {
            openManageSubscription();
            return;
        }
        const pkg = selectedPkg || packages[0];
        if (!pkg) {
            retryRef.current = handleRetry;
            setFailure({
                title: 'Plans didn’t load',
                message: 'Give it a moment, then try again.',
                actions: [{ label: 'Try again', action: 'retry' }],
            });
            return;
        }
        if (USE_MOCK_PLANS) {
            Alert.alert('Preview mode', 'Subscriptions run in a development or production build — not in Expo Go.');
            return;
        }
        setPurchasing(true);
        track('paywall_purchase_started', { plan: 'monthly', price: selectedPrice, variant: 'standard' });
        recordPaywallInteraction('purchase_started', postFreemium);
        try {
            const success = await purchasePackage(pkg);
            if (success) {
                track('paywall_purchase_succeeded', { plan: 'monthly', price: selectedPrice, variant: 'standard' });
                safeExit();
            } else {
                track('paywall_purchase_cancelled', { plan: 'monthly', variant: 'standard' });
            }
        } catch (e: unknown) {
            // purchasePackage already swallows user-cancellation (returns
            // false) — anything thrown here is a real failure the user must
            // see, not a silent dead end.
            const appErr = toAppError(e);
            appErr.kind = 'purchase';
            reportError(appErr, 'purchase');
            track('paywall_purchase_failed', {
                reason: e instanceof Error ? e.message : 'exception',
                variant: 'standard',
            });
            retryRef.current = handlePurchase;
            setFailure(errorCopy(appErr, { context: 'purchase' }));
        } finally {
            setPurchasing(false);
        }
    };

    // Exit that can never dead-end: ask.tsx reaches this screen via
    // router.replace, so back() can have nothing to pop — the X would then
    // silently no-op and the user is trapped on the paywall.
    const safeExit = useCallback(() => {
        if (router.canGoBack()) {
            router.back();
        } else {
            router.replace('/(tabs)' as any);
        }
    }, [router]);

    const handleDismiss = () => {
        track('paywall_dismissed', { mode, variant: 'standard' });
        recordPaywallInteraction('dismiss', postFreemium);
        safeExit();
    };

    const handleRestore = () => {
        track('paywall_restore_tapped', { variant: 'standard' });
        restorePurchases();
    };

    // ─── Already subscribed ───
    if (isPro) {
        return (
            <View style={[styles.container, { paddingTop: insets.top }]}>
                <StatusBar style="dark" />
                <TouchableOpacity
                    style={[styles.closeBtn, { top: insets.top + 8 }]}
                    onPress={safeExit}
                    activeOpacity={0.7}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                    <CloseIcon />
                </TouchableOpacity>

                <View style={styles.activeWrap}>
                    <Animated.View entering={FadeInDown.duration(450)} style={styles.activeInner}>
                        <View style={styles.brandPill}>
                            <View style={styles.brandIcon}>
                                <BrandMark />
                            </View>
                            <Text style={styles.brandLabel}>Pawtchi Plus</Text>
                        </View>
                        <Text style={styles.headlineDisplay}>
                            {"YOU'RE\nALL SET."}
                        </Text>
                        <Text style={styles.subcopy}>
                            {/* Granted access — a creator code, or a comped
                                creator — is `isPro` with no store subscription
                                behind it. The paid copy would tell them their
                                plan renews, which it does not. */}
                            {grantedUntil
                                ? promoPaywallBody(grantedUntil)
                                : petName
                                    ? `You're already on Pawtchi Plus. ${petPossessive} full picture is unlocked.`
                                    : "You're already on Pawtchi Plus. Your pet's full picture is unlocked."}
                        </Text>
                    </Animated.View>
                </View>

                <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
                    {/* No "Manage subscription" on granted access. There is
                        nothing at the store to manage, so the button would open
                        an empty App Store subscriptions page — a dead end that
                        reads as our billing being broken. */}
                    {!grantedUntil && (
                        <TouchableOpacity style={styles.cta} onPress={openManageSubscription} activeOpacity={0.9}>
                            <Text style={styles.ctaText}>Manage subscription</Text>
                        </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={safeExit} style={styles.activeCloseBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Text style={styles.activeCloseText}>Close</Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    }

    // CTA label adapts to load state
    const ctaLabel = !loaded
        ? (loadState === 'error' ? 'Try again' : 'Loading…')
        : trialPhrase
            ? 'Start Free Trial'
            : `Subscribe — ${selectedPrice}/${periodWord}`;
    const ctaOnPress = loadState === 'error' ? handleRetry : handlePurchase;
    const ctaDisabled = loadState === 'loading' || purchasing;

    // Legal line below CTA — always derived from live data
    const legalLine = loaded && selectedPkg
        ? trialPhrase
            ? `${capitalize(trialPhrase)}, then ${selectedPrice}/month · Cancel anytime`
            : `${selectedPrice}/month · Cancel anytime`
        : '';

    return (
        <View style={styles.container}>
            <StatusBar style="dark" />

            {/* ─── HERO MOSAIC ─── */}
            <Animated.View entering={FadeIn.duration(500)} style={styles.hero}>
                <View style={styles.mosaic}>
                    {/* Left column */}
                    <View style={styles.mosaicSide}>
                        <View style={styles.mosaicSideCell}>
                            <Image source={MOSAIC.topLeft} style={styles.mosaicImg} />
                        </View>
                        <MaskedView
                            style={[styles.mosaicSideCell, { marginTop: -20, zIndex: 1 }]}
                            maskElement={
                                <LinearGradient
                                    style={{ flex: 1 }}
                                    colors={['transparent', '#000']}
                                    locations={[0, 0.25]}
                                />
                            }
                        >
                            <Image source={MOSAIC.bottomLeft} style={styles.mosaicImg} />
                        </MaskedView>
                    </View>
                    {/* Center column (tall, spans full height) */}
                    <MaskedView
                        style={[styles.mosaicCenterCol, { marginHorizontal: -20, zIndex: 1 }]}
                        maskElement={
                            <LinearGradient
                                style={{ flex: 1 }}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 0 }}
                                colors={['transparent', '#000', '#000', 'transparent']}
                                locations={[0, 0.15, 0.85, 1]}
                            />
                        }
                    >
                        <Image source={MOSAIC.center} style={styles.mosaicImg} />
                    </MaskedView>
                    {/* Right column */}
                    <View style={styles.mosaicSide}>
                        <View style={styles.mosaicSideCell}>
                            <Image source={MOSAIC.topRight} style={styles.mosaicImg} />
                        </View>
                        <MaskedView
                            style={[styles.mosaicSideCell, { marginTop: -20, zIndex: 1 }]}
                            maskElement={
                                <LinearGradient
                                    style={{ flex: 1 }}
                                    colors={['transparent', '#000']}
                                    locations={[0, 0.25]}
                                />
                            }
                        >
                            <Image source={MOSAIC.bottomRight} style={styles.mosaicImg} />
                        </MaskedView>
                    </View>
                </View>

                {/* Gradient fade to white */}
                <LinearGradient
                    colors={['transparent', '#ffffff']}
                    locations={[0, 0.85]}
                    style={[styles.heroGradient, { zIndex: 10 }]}
                    pointerEvents="none"
                />

                {/* Close button */}
                <TouchableOpacity
                    style={[styles.closeBtn, { top: insets.top + 8 }]}
                    onPress={handleDismiss}
                    activeOpacity={0.7}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                    <CloseIcon />
                </TouchableOpacity>
            </Animated.View>

            {/* ─── BOTTOM CONTENT ─── */}
            <Animated.View entering={FadeInDown.duration(500).delay(150)} style={styles.content}>
                {USE_MOCK_PLANS && (
                    <View style={styles.devBanner}>
                        <Text style={styles.devBannerText}>DEV PREVIEW · SAMPLE PRICES</Text>
                    </View>
                )}

                {/* Brand pill */}
                <View style={styles.brandPill}>
                    <View style={styles.brandIcon}>
                        <BrandMark />
                    </View>
                    <Text style={styles.brandLabel}>Pawtchi Plus</Text>
                </View>

                {/* Headline with yellow highlight bar */}
                <View style={styles.headlineWrap}>
                    <Text style={styles.headlineDisplay}>NOTICE </Text>
                    <View style={styles.highlightWrap}>
                        <View style={styles.highlightBar} />
                        <Text style={styles.headlineDisplay}>EVERYTHING</Text>
                    </View>
                    <Text style={styles.headlineDisplay}>.</Text>
                </View>

                {/* Subhead */}
                <Text style={styles.subcopy}>
                    Pawtchi catches the slow changes in {petPossessive}{" weight, food and energy — while they're still small."}
                </Text>

                {/* Testimonial + rating */}
                <View style={styles.testimonialRow}>
                    <View style={styles.testimonialPill}>
                        <View style={styles.testimonialAvatar}>
                            <Text style={styles.testimonialInitial}>M</Text>
                        </View>
                        <Text style={styles.testimonialQuote}>
                            {'"Caught it weeks before our vet did." '}<Text style={styles.testimonialAuthor}>— Mos</Text>
                        </Text>
                    </View>
                    <View style={styles.ratingWrap}>
                        <StarIcon />
                        <Text style={styles.ratingText}>4.9</Text>
                    </View>
                </View>

                {/* CTA */}
                {loadState === 'error' ? (
                    <View style={styles.errorWrap}>
                        <Text style={styles.errorText}>{"Couldn't load plans right now."}</Text>
                        <TouchableOpacity style={styles.retryBtn} onPress={handleRetry} activeOpacity={0.85}>
                            <MaterialIcons name="refresh" size={16} color={NAVY} />
                            <Text style={styles.retryText}>Retry</Text>
                        </TouchableOpacity>
                        {/* A store hiccup must never trap anyone — freemium users
                            have full access anyway, so give them the door. */}
                        {isFreemiumActive && (
                            <TouchableOpacity onPress={handleDismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                                <Text style={styles.errorContinueLink}>
                                    Continue with your free access for now
                                </Text>
                            </TouchableOpacity>
                        )}
                        {__DEV__ && (
                            <Text style={styles.devHint}>
                                {isConfigured === false
                                    ? 'Dev note: in-app purchases load in a development build, not Expo Go.'
                                    : 'Dev note: sideloaded builds often can’t reach Google Play billing — plans load when installed via a Play testing track.'}
                            </Text>
                        )}
                    </View>
                ) : (
                    <PulseGlowCTA
                        label={ctaLabel}
                        onPress={ctaOnPress}
                        disabled={ctaDisabled}
                    />
                )}

                {/* Legal */}
                {legalLine !== '' && <Text style={styles.legal}>{legalLine}</Text>}

                {/* Feature chips */}
                <View style={styles.chips}>
                    {FEATURE_CHIPS.map(({ label, Icon }) => (
                        <View key={label} style={styles.chip}>
                            <Icon />
                            <Text style={styles.chipLabel}>{label}</Text>
                        </View>
                    ))}
                </View>

                {/* Footer links */}
                <View style={styles.footerLinks}>
                    {/* The one entry point that matters. This is the screen a
                        creator's audience lands on the moment they hit anything
                        gated, so it is where someone holding a code is actually
                        looking — no new navigation, no onboarding step, and no
                        prominence taken from the purchase this screen exists
                        for. "Creator code", never "promo code": the latter is
                        the App Store's own feature name. */}
                    <TouchableOpacity
                        onPress={() => router.push('/redeem' as never)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                        <Text style={styles.footerLink}>Have a creator code?</Text>
                    </TouchableOpacity>
                    <Text style={styles.footerDot}>·</Text>
                    <TouchableOpacity onPress={handleRestore} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Text style={styles.footerLink}>Restore purchase</Text>
                    </TouchableOpacity>
                    <Text style={styles.footerDot}>·</Text>
                    <TouchableOpacity onPress={() => router.push('/privacy')}>
                        <Text style={styles.footerLink}>Privacy</Text>
                    </TouchableOpacity>
                    <Text style={styles.footerDot}>·</Text>
                    <TouchableOpacity onPress={() => Linking.openURL('https://pawtchi.com/terms')}>
                        <Text style={styles.footerLink}>Terms</Text>
                    </TouchableOpacity>
                    <Text style={styles.footerDot}>·</Text>
                    {/* Billing is the single biggest driver of support contact in
                        consumer subscription apps, and this is the screen where
                        the questions form. Opens the composer with the topic and
                        area already chosen, so there is nothing to categorise. */}
                    <TouchableOpacity
                        onPress={() =>
                            router.push({
                                pathname: '/support/new',
                                params: { topic: 'question', area: 'subscription', source: 'paywall' },
                            } as never)
                        }
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                        <Text style={styles.footerLink}>{BILLING_HELP_LABEL}</Text>
                    </TouchableOpacity>
                </View>
            </Animated.View>
            {/* Loader ONLY during an active purchase — never during offerings
                load. The initial load is shown inline (CTA reads "Loading…",
                disabled) so the screen stays interactive and the close button
                is always tappable. A full-screen opaque loader over the whole
                paywall (incl. the X) is what trapped users when a store call
                stalled — the paywall must never become uncloseable. */}
            <PawLoader visible={purchasing} message="Processing…" />

            {/* Branded failure sheet — purchase paths land here, never a raw alert. */}
            <FailureModal
                copy={failure}
                onClose={() => setFailure(null)}
                onAction={handleRecovery}
                meta={{ context: 'purchase', screen: '/paywall' }}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#ffffff',
    },

    // ─── Hero mosaic ───
    hero: {
        width: '100%',
        height: HERO_HEIGHT,
        overflow: 'hidden',
    },
    mosaic: {
        flex: 1,
        flexDirection: 'row',
    },
    mosaicSide: {
        flex: 1,
    },
    mosaicSideCell: {
        flex: 1,
        overflow: 'hidden',
    },
    mosaicCenterCol: {
        flex: 1.4,
        overflow: 'hidden',
    },
    mosaicImg: {
        width: '100%',
        height: '100%',
        resizeMode: 'cover',
    },
    heroGradient: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 240,
    },

    // ─── Close button ───
    closeBtn: {
        position: 'absolute',
        right: 14,
        width: 30,
        height: 30,
        backgroundColor: 'rgba(255,255,255,0.8)',
        borderRadius: 15,
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 10,
    },

    // ─── Bottom content ───
    content: {
        flex: 1,
        alignItems: 'center',
        paddingHorizontal: 28,
        marginTop: -20,
    },

    devBanner: {
        backgroundColor: color.yellowSoft,
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 4,
        marginBottom: 8,
    },
    devBannerText: {
        fontFamily: BODY_SEMI,
        fontSize: 9.5,
        letterSpacing: 0.5,
        color: NAVY,
    },

    // Brand pill
    brandPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 12,
    },
    brandIcon: {
        width: 18,
        height: 18,
        backgroundColor: YELLOW,
        borderRadius: 5,
        justifyContent: 'center',
        alignItems: 'center',
    },
    brandLabel: {
        fontFamily: BODY_BOLD,
        fontSize: 12,
        letterSpacing: 1.5,
        color: NAVY,
        textTransform: 'uppercase',
    },

    // Headline
    headlineWrap: {
        flexDirection: 'row',
        alignItems: 'baseline',
        flexWrap: 'wrap',
        justifyContent: 'center',
        marginBottom: 10,
    },
    headlineDisplay: {
        fontFamily: DISPLAY,
        fontSize: 38,
        lineHeight: 40,
        letterSpacing: 1,
        color: NAVY,
    },
    highlightWrap: {
        position: 'relative',
    },
    highlightBar: {
        position: 'absolute',
        left: -4,
        right: -4,
        bottom: 6,
        height: 14,
        backgroundColor: YELLOW,
        transform: [{ skewX: '-8deg' }],
    },

    // Subcopy
    subcopy: {
        fontFamily: BODY,
        fontSize: 14,
        lineHeight: 21,
        color: GRAY_500,
        textAlign: 'center',
        maxWidth: 300,
        marginBottom: 16,
    },

    // Testimonial
    testimonialRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 16,
        maxWidth: 340,
    },
    testimonialPill: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: TESTIMONIAL_BG,
        borderWidth: 1,
        borderColor: TESTIMONIAL_BORDER,
        borderRadius: 20,
        paddingVertical: 5,
        paddingRight: 10,
        paddingLeft: 5,
    },
    testimonialAvatar: {
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: YELLOW,
        justifyContent: 'center',
        alignItems: 'center',
    },
    testimonialInitial: {
        fontFamily: BODY_XB,
        fontSize: 11,
        color: NAVY,
    },
    testimonialQuote: {
        fontFamily: BODY,
        fontSize: 11,
        lineHeight: 13.2,
        color: NAVY,
        fontStyle: 'italic',
        flex: 1,
    },
    testimonialAuthor: {
        fontStyle: 'normal',
        fontFamily: BODY_SEMI,
        color: GRAY_400,
    },
    ratingWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
    },
    ratingText: {
        fontFamily: BODY_XB,
        fontSize: 11,
        color: NAVY,
    },

    // CTA
    cta: {
        width: '100%',
        backgroundColor: YELLOW,
        borderRadius: 18,
        paddingVertical: 20,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 10,
        // Shadow mimics the pulse-glow from the design
        ...makeShadow(8, 24, 0.45, YELLOW),
    },
    ctaDisabled: {
        opacity: 0.55,
    },
    ctaInner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    ctaText: {
        fontFamily: BODY_XB,
        fontSize: 18,
        color: NAVY,
        letterSpacing: -0.3,
    },

    // Legal
    legal: {
        fontFamily: BODY,
        fontSize: 11,
        color: GRAY_400,
        textAlign: 'center',
        lineHeight: 15.4,
        marginBottom: 12,
    },

    // Feature chips
    chips: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: 6,
        marginTop: 6,
    },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        backgroundColor: CHIP_BG,
        borderWidth: 1,
        borderColor: CHIP_BORDER,
        borderRadius: 20,
        paddingVertical: 7,
        paddingHorizontal: 14,
    },
    chipLabel: {
        fontFamily: BODY_SEMI,
        fontSize: 12,
        color: NAVY,
        textTransform: 'uppercase',
        letterSpacing: 0.3,
    },

    // Error state
    errorWrap: {
        alignItems: 'center',
        gap: 10,
        marginBottom: 16,
    },
    errorText: {
        fontFamily: BODY_MED,
        fontSize: 14,
        color: NAVY,
    },
    retryBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderWidth: 1,
        borderColor: NAVY,
        borderRadius: 12,
        paddingVertical: 10,
        paddingHorizontal: 18,
    },
    retryText: {
        fontFamily: BODY_SEMI,
        fontSize: 14,
        color: NAVY,
    },
    errorContinueLink: {
        fontFamily: BODY_SEMI,
        fontSize: 13,
        color: GRAY_500,
        textDecorationLine: 'underline',
        textAlign: 'center',
        paddingVertical: 4,
    },
    devHint: {
        fontFamily: BODY,
        fontSize: 11,
        color: GRAY_400,
        maxWidth: 320,
        textAlign: 'center',
    },

    // Footer links
    footerLinks: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 16,
    },
    footerLink: {
        fontFamily: BODY_MED,
        fontSize: 11,
        color: GRAY_400,
        textDecorationLine: 'underline',
    },
    footerDot: {
        color: GRAY_400,
        fontSize: 11,
    },

    // Already subscribed
    activeWrap: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 28,
    },
    activeInner: {
        alignItems: 'center',
        width: '100%',
    },
    activeCloseBtn: {
        alignSelf: 'center',
        marginTop: 14,
    },
    activeCloseText: {
        fontFamily: BODY_MED,
        fontSize: 14,
        color: GRAY_500,
    },
    bottomBar: {
        paddingHorizontal: 24,
        paddingTop: 14,
    },
});
