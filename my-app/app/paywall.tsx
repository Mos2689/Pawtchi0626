import React, { useState, useEffect, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    ActivityIndicator,
    Alert,
    Platform,
    Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Purchases, { PurchasesPackage } from 'react-native-purchases';
import Constants from 'expo-constants';
import { useFonts, Montserrat_400Regular, Montserrat_500Medium, Montserrat_600SemiBold } from '@expo-google-fonts/montserrat';
import { BebasNeue_400Regular } from '@expo-google-fonts/bebas-neue';
import { useActivePetStore } from '../store/useActivePetStore';
import { useSubscription } from '../hooks/useSubscription';
import { track } from '../lib/analytics';
import { openManageSubscription } from '../lib/manageSubscription';

// ─── Brand system (Pawtchi Brand Book 2026, Part IV) ───
// Navy ground + electric yellow accent only. Yellow marks the ONE thing that
// matters (§4.02) — here, the call to action. Bebas Neue display, Montserrat body
// (§4.03). Left-aligned, one idea per surface (§4.06).
const NAVY = '#07202A';
const NAVY_RAISED = '#0B2A36';
const YELLOW = '#F7F602';
const CREAM = '#F4F1EC';
const CREAM_DIM = 'rgba(244, 241, 236, 0.66)';
const CREAM_FAINT = 'rgba(244, 241, 236, 0.42)';
const HAIRLINE = 'rgba(244, 241, 236, 0.14)';

const DISPLAY = 'BebasNeue_400Regular';
const BODY = 'Montserrat_400Regular';
const BODY_MED = 'Montserrat_500Medium';
const BODY_SEMI = 'Montserrat_600SemiBold';

const OFFERINGS_TIMEOUT_MS = 8000;

// In Expo Go the RevenueCat native module isn't available, so live offerings never
// load and the paywall can't be previewed. To preview the full UI during development
// we fall back to SAMPLE prices — but only in Expo Go AND only when `__DEV__` is true.
//
// The `__DEV__` guard is the safety contract: a production release build compiles with
// `__DEV__ === false`, so it is ALWAYS live, data-driven, and can NEVER render these
// placeholders — keeping the store-reviewed build compliant with pricing policy.
const IS_EXPO_GO =
    Constants.appOwnership === 'expo' ||
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Constants as any).executionEnvironment === 'storeClient';
const USE_MOCK_PLANS = __DEV__ && IS_EXPO_GO;

// Shape mirrors only the RevenueCat fields the paywall actually reads.
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

// Concrete features the subscription unlocks. "Instant food scanning" replaces the
// old "AI-powered food scanning" — the brand book bans the word "AI" (§6.04 rule 06).
const FEATURES: { icon: keyof typeof MaterialIcons.glyphMap; label: string }[] = [
    { icon: 'photo-camera', label: 'Instant food scanning' },
    { icon: 'directions-run', label: 'Activity & walk tracking' },
    { icon: 'insights', label: 'Weekly health insights' },
    { icon: 'notifications-none', label: 'Smart pet reminders' },
    { icon: 'description', label: 'Vet report analysis' },
    { icon: 'show-chart', label: 'Calorie & nutrition trends' },
];

// ─── Pricing helpers ───
// Every price and trial term is derived from live, localized RevenueCat product
// data so the offer screen always matches the store cart (Play Subscriptions policy).

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

function getTrialPhrase(pkg?: PurchasesPackage): string | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p: any = pkg?.product;
    if (!p) return null;
    const intro = p.introPrice;
    if (intro && Number(intro.price) === 0) {
        const ph = periodPhrase(intro.periodUnit, intro.periodNumberOfUnits, intro.period);
        if (ph) return `${ph} free trial`;
    }
    const opt = p.defaultOption || (Array.isArray(p.subscriptionOptions) ? p.subscriptionOptions[0] : null);
    const bp = opt?.freePhase?.billingPeriod;
    if (bp) {
        const ph = periodPhrase(bp.unit, bp.value, bp.iso8601);
        if (ph) return `${ph} free trial`;
    }
    return null;
}

function getPerMonthString(pkg?: PurchasesPackage): string | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p: any = pkg?.product;
    return p?.pricePerMonthString ?? null;
}

// Localized per-week price (e.g. "A$1.52") — used as the conversion anchor on the
// plan cards even though billing is yearly/monthly. Comes from the store, so the
// currency always matches the cart.
function getPerWeekString(pkg?: PurchasesPackage): string | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p: any = pkg?.product;
    return p?.pricePerWeekString ?? null;
}

function getSavingsPercent(yearly?: PurchasesPackage, monthly?: PurchasesPackage): number | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const y: any = yearly?.product;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m: any = monthly?.product;
    const yPerMonth = typeof y?.pricePerMonth === 'number' ? y.pricePerMonth : (typeof y?.price === 'number' ? y.price / 12 : null);
    const mPrice = typeof m?.price === 'number' ? m.price : null;
    if (!yPerMonth || !mPrice || mPrice <= 0) return null;
    const pct = Math.round((1 - yPerMonth / mPrice) * 100);
    return pct > 0 && pct < 100 ? pct : null;
}

export default function PaywallScreen() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { activePet } = useActivePetStore();
    const { restorePurchases, purchasePackage, getOfferings, status, isPro, isFreemiumActive, daysSinceCreation } = useSubscription();

    const [fontsLoaded] = useFonts({
        BebasNeue_400Regular,
        Montserrat_400Regular,
        Montserrat_500Medium,
        Montserrat_600SemiBold,
    });

    const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'yearly'>('yearly');
    const [purchasing, setPurchasing] = useState(false);
    const [packages, setPackages] = useState<PurchasesPackage[]>([]);
    const [loadState, setLoadState] = useState<LoadState>('loading');
    const [isConfigured, setIsConfigured] = useState<boolean | null>(null);

    const petName = activePet?.name?.trim() || null;
    const petPossessive = petName ? `${petName}'s` : "your animal's";

    const mode = deriveMode(status, isFreemiumActive, daysSinceCreation);
    const showDismiss = mode !== 'renewal';

    const headline = mode === 'renewal' ? 'PICK UP\nWHERE YOU\nLEFT OFF.' : 'NOTICE\nEVERYTHING.';
    const subcopy =
        mode === 'renewal'
            ? `${capitalize(petPossessive)} history is safe. Pick up the patterns right where you left off.`
            : mode === 'upgrade'
                ? `Keep noticing the slow changes in ${petPossessive} weight, food and energy — Pawtchi is already watching.`
                : `Pawtchi notices the slow changes in ${petPossessive} weight, food and energy, while they're still small. Free to start.`;

    // ─── Robust offerings load: timeout + retry + error state (never an infinite spinner) ───
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
                track('paywall_offerings_error', { reason: 'empty' });
            }
        } catch (e: unknown) {
            if (USE_MOCK_PLANS) {
                setPackages(MOCK_PACKAGES);
                setLoadState('loaded');
            } else {
                setPackages([]);
                setLoadState('error');
                track('paywall_offerings_error', { reason: e instanceof Error ? e.message : 'exception' });
            }
        }
    }, [getOfferings]);

    useEffect(() => {
        loadOfferings();
    }, [loadOfferings]);

    // One-time: record the view, and (dev only) learn whether RevenueCat is configured.
    useEffect(() => {
        track('paywall_viewed', { mode });
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
        track('paywall_offerings_retried', {});
        loadOfferings();
    };

    // Live, localized pricing — sourced from the store, never hardcoded.
    const loaded = loadState === 'loaded';
    const yearlyPkg = packages.find((p) => p.packageType === 'ANNUAL');
    const monthlyPkg = packages.find((p) => p.packageType === 'MONTHLY');
    const selectedPkg = selectedPlan === 'yearly' ? yearlyPkg : monthlyPkg;
    const selectedPrice = selectedPkg?.product.priceString ?? '';
    const periodWord = selectedPlan === 'yearly' ? 'year' : 'month';
    const trialPhrase = getTrialPhrase(selectedPkg);
    const yearSavings = getSavingsPercent(yearlyPkg, monthlyPkg);

    const selectPlan = (plan: 'monthly' | 'yearly') => {
        setSelectedPlan(plan);
        track('paywall_plan_selected', { plan });
    };

    // Plan card — anchored on the per-week price (cheap, approachable) while billing
    // stays yearly/monthly. Selected card fills electric yellow with navy text.
    const renderPlanCard = (plan: 'yearly' | 'monthly', pkg: PurchasesPackage) => {
        const selected = selectedPlan === plan;
        const perWeek = getPerWeekString(pkg);
        const name = plan === 'yearly' ? 'Yearly' : 'Monthly';
        const billed = plan === 'yearly' ? 'billed yearly' : 'billed monthly';
        const mainColor = selected ? NAVY : CREAM;
        const dimColor = selected ? 'rgba(7, 32, 42, 0.62)' : CREAM_DIM;
        return (
            <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => selectPlan(plan)}
                style={[styles.planCard, selected && styles.planCardSelected]}
            >
                <View style={styles.planTopRow}>
                    <Text style={[styles.planName, { color: mainColor }]}>{name}</Text>
                    {plan === 'yearly' && yearSavings !== null && (
                        <View style={[styles.badge, selected && styles.badgeSelected]}>
                            <Text style={styles.badgeText}>{`SAVE ${yearSavings}%`}</Text>
                        </View>
                    )}
                </View>
                <Text style={[styles.planWeek, { color: mainColor }]}>
                    {perWeek ? `${perWeek} ` : `${pkg.product.priceString} `}
                    <Text style={[styles.planWeekUnit, { color: dimColor }]}>
                        {perWeek ? '/ week' : `/ ${plan === 'yearly' ? 'year' : 'month'}`}
                    </Text>
                </Text>
                <Text style={[styles.planBilled, { color: dimColor }]}>{`${pkg.product.priceString} ${billed}`}</Text>
            </TouchableOpacity>
        );
    };

    const handlePurchase = async () => {
        // Guard the brief window before entitlement status resolves: an active
        // subscriber should manage, never re-purchase.
        if (isPro) {
            openManageSubscription();
            return;
        }
        const pkg = selectedPkg || packages[0];
        if (!pkg) {
            Alert.alert('No plans available', 'Please try again in a moment.');
            return;
        }
        if (USE_MOCK_PLANS) {
            Alert.alert('Preview mode', 'Subscriptions run in a development or production build — not in Expo Go.');
            return;
        }
        setPurchasing(true);
        track('paywall_purchase_started', { plan: selectedPlan, price: selectedPrice });
        try {
            const success = await purchasePackage(pkg);
            if (success) {
                track('paywall_purchase_succeeded', { plan: selectedPlan, price: selectedPrice });
                router.back();
            } else {
                track('paywall_purchase_cancelled', { plan: selectedPlan });
            }
        } catch (e: unknown) {
            track('paywall_purchase_failed', { reason: e instanceof Error ? e.message : 'exception' });
            console.error('Purchase error:', e);
        } finally {
            setPurchasing(false);
        }
    };

    const handleDismiss = () => {
        track('paywall_dismissed', { mode });
        router.back();
    };

    const handleRestore = () => {
        track('paywall_restore_tapped', {});
        restorePurchases();
    };

    if (!fontsLoaded) {
        return (
            <View style={[styles.container, styles.center]}>
                <StatusBar style="light" />
                <ActivityIndicator color={YELLOW} />
            </View>
        );
    }

    // ─── Already subscribed: never show a purchase CTA ───
    // An active subscriber who reaches this screen must not be able to buy again —
    // that triggers the store's "you already own this" error. Show a calm confirmation
    // with a Manage option that deep-links to the store, never the in-app purchase flow.
    if (isPro) {
        return (
            <View style={[styles.container, { paddingTop: insets.top }]}>
                <StatusBar style="light" />
                <TouchableOpacity
                    style={[styles.closeButton, { top: insets.top + 8 }]}
                    onPress={() => router.back()}
                    activeOpacity={0.7}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                    <MaterialIcons name="close" size={24} color={CREAM_DIM} />
                </TouchableOpacity>

                <View style={styles.activeWrap}>
                    <Animated.View entering={FadeInDown.duration(450)} style={styles.activeInner}>
                        <View style={styles.activeBadge}>
                            <MaterialIcons name="check-circle" size={16} color={NAVY} />
                            <Text style={styles.activeBadgeText}>
                                {status === 'trial' ? 'TRIAL ACTIVE' : 'ACTIVE'}
                            </Text>
                        </View>
                        <Text style={styles.eyebrow}>PAWTCHI PLUS</Text>
                        <Text style={styles.headline}>{'YOU’RE\nALL SET.'}</Text>
                        <Text style={styles.subcopy}>
                            {petName
                                ? `You're already on Pawtchi Plus. ${petPossessive} full picture is unlocked.`
                                : "You're already on Pawtchi Plus. Your animal's full picture is unlocked."}
                        </Text>
                    </Animated.View>
                </View>

                <View style={[styles.stickyBar, { paddingBottom: insets.bottom + 12 }]}>
                    <TouchableOpacity style={styles.cta} onPress={openManageSubscription} activeOpacity={0.9}>
                        <Text style={styles.ctaText}>Manage subscription</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => router.back()} style={styles.activeClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Text style={styles.activeCloseText}>Close</Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    }

    // Sticky CTA button behaviour adapts to load state.
    const ctaLabel = !loaded
        ? (loadState === 'error' ? 'Try again' : 'Loading…')
        : trialPhrase
            ? `Start your ${trialPhrase}`
            : `Subscribe — ${selectedPrice}/${periodWord}`;
    const ctaOnPress = loadState === 'error' ? handleRetry : handlePurchase;
    const ctaDisabled = loadState === 'loading' || purchasing;

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            <StatusBar style="light" />

            {showDismiss && (
                <TouchableOpacity
                    style={[styles.closeButton, { top: insets.top + 8 }]}
                    onPress={handleDismiss}
                    activeOpacity={0.7}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                    <MaterialIcons name="close" size={24} color={CREAM_DIM} />
                </TouchableOpacity>
            )}

            <ScrollView
                contentContainerStyle={[styles.scroll, { paddingBottom: 230 + insets.bottom }]}
                showsVerticalScrollIndicator={false}
                bounces={false}
            >
                {USE_MOCK_PLANS && (
                    <View style={styles.devBanner}>
                        <Text style={styles.devBannerText}>DEV PREVIEW · SAMPLE PRICES (EXPO GO)</Text>
                    </View>
                )}

                <Animated.View entering={FadeInDown.duration(450)}>
                    <Text style={styles.eyebrow}>PAWTCHI PLUS</Text>
                    <Text style={styles.headline}>{headline}</Text>
                    <Text style={styles.subcopy}>{subcopy}</Text>
                </Animated.View>

                {/* What's included — concrete, scannable (§4.05 line icons, cream not yellow) */}
                <Animated.View entering={FadeInDown.duration(450).delay(70)} style={styles.features}>
                    <Text style={styles.sectionLabel}>WHAT&apos;S INCLUDED</Text>
                    {FEATURES.map((f) => (
                        <View key={f.label} style={styles.featureRow}>
                            <MaterialIcons name={f.icon} size={20} color={CREAM} style={styles.featureIcon} />
                            <Text style={styles.featureText}>{f.label}</Text>
                        </View>
                    ))}
                </Animated.View>

                {/* Plans */}
                <Animated.View entering={FadeInDown.duration(450).delay(140)} style={styles.plans}>
                    {loadState === 'loading' && (
                        <View style={styles.plansState}>
                            <ActivityIndicator color={CREAM_DIM} />
                            <Text style={styles.fine}>Loading plans…</Text>
                        </View>
                    )}

                    {loadState === 'error' && (
                        <View style={styles.plansState}>
                            <Text style={styles.errorText}>We couldn&apos;t load plans right now.</Text>
                            <TouchableOpacity style={styles.retryBtn} onPress={handleRetry} activeOpacity={0.85}>
                                <MaterialIcons name="refresh" size={16} color={CREAM} />
                                <Text style={styles.retryText}>Retry</Text>
                            </TouchableOpacity>
                            {__DEV__ && isConfigured === false && (
                                <Text style={styles.devHint}>Dev note: in-app purchases load in a development build, not Expo Go.</Text>
                            )}
                        </View>
                    )}

                    {loaded && (
                        <>
                            {yearlyPkg && renderPlanCard('yearly', yearlyPkg)}
                            {monthlyPkg && renderPlanCard('monthly', monthlyPkg)}
                        </>
                    )}
                </Animated.View>

                {/* Footer — restore + legal (kept off the sticky bar to keep it focused) */}
                <TouchableOpacity onPress={handleRestore} style={styles.restoreBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={styles.restoreText}>Restore purchase</Text>
                </TouchableOpacity>

                {loaded && selectedPkg && (
                    <Text style={styles.legal}>
                        {Platform.OS === 'android'
                            ? `Payment is charged to your Google Play account at confirmation.${trialPhrase ? ` Your free trial converts to a paid subscription (${selectedPrice}/${periodWord}) when it ends unless cancelled beforehand.` : ''} It renews at ${selectedPrice}/${periodWord} unless cancelled at least 24 hours before the period ends. Manage in Google Play → Subscriptions.`
                            : `Payment is charged to your Apple ID at confirmation.${trialPhrase ? ` Your free trial converts to a paid subscription (${selectedPrice}/${periodWord}) when it ends unless cancelled beforehand.` : ''} It renews at ${selectedPrice}/${periodWord} unless auto-renew is turned off at least 24 hours before the period ends. Manage in Settings → Apple ID → Subscriptions.`}
                    </Text>
                )}

                <View style={styles.legalLinks}>
                    <TouchableOpacity onPress={() => router.push('/privacy')}>
                        <Text style={styles.legalLink}>Privacy Policy</Text>
                    </TouchableOpacity>
                    <Text style={styles.legalDot}>·</Text>
                    <TouchableOpacity onPress={() => Linking.openURL('https://pawtchi.com/terms')}>
                        <Text style={styles.legalLink}>Terms of Use</Text>
                    </TouchableOpacity>
                </View>
            </ScrollView>

            {/* ─── Sticky conversion bar — always visible ─── */}
            <View style={[styles.stickyBar, { paddingBottom: insets.bottom + 12 }]}>
                {loaded && selectedPkg && (
                    <Text style={styles.stickyTerms}>
                        {trialPhrase
                            ? `${capitalize(trialPhrase)}, then ${selectedPrice}/${periodWord}. Cancel anytime in ${Platform.OS === 'android' ? 'Google Play → Subscriptions' : 'App Store settings'}.`
                            : `${selectedPrice}/${periodWord}. Cancel anytime in ${Platform.OS === 'android' ? 'Google Play → Subscriptions' : 'App Store settings'}.`}
                    </Text>
                )}
                <TouchableOpacity
                    style={[styles.cta, ctaDisabled && styles.ctaDisabled]}
                    onPress={ctaOnPress}
                    disabled={ctaDisabled}
                    activeOpacity={0.9}
                >
                    {purchasing ? <ActivityIndicator color={NAVY} /> : <Text style={styles.ctaText}>{ctaLabel}</Text>}
                </TouchableOpacity>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: NAVY },
    center: { justifyContent: 'center', alignItems: 'center' },
    closeButton: {
        position: 'absolute',
        right: 20,
        zIndex: 10,
        width: 36,
        height: 36,
        borderRadius: 18,
        justifyContent: 'center',
        alignItems: 'center',
    },
    scroll: {
        paddingHorizontal: 24,
        paddingTop: 52,
    },

    // Dev-only preview banner (never compiled into a production release)
    devBanner: {
        alignSelf: 'flex-start',
        backgroundColor: 'rgba(247, 246, 2, 0.14)',
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 4,
        marginBottom: 16,
    },
    devBannerText: {
        fontFamily: BODY_SEMI,
        fontSize: 9.5,
        letterSpacing: 0.5,
        color: YELLOW,
    },

    // Already-subscribed state
    activeWrap: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
    activeInner: { alignItems: 'flex-start', width: '100%' },
    activeBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: YELLOW,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 5,
        marginBottom: 20,
    },
    activeBadgeText: {
        fontFamily: BODY_SEMI,
        fontSize: 11,
        letterSpacing: 1,
        color: NAVY,
    },
    activeClose: { alignSelf: 'center', marginTop: 14 },
    activeCloseText: { fontFamily: BODY_MED, fontSize: 14, color: CREAM_DIM },

    // Hero
    eyebrow: {
        fontFamily: BODY_SEMI,
        fontSize: 12,
        letterSpacing: 3,
        color: CREAM_DIM,
        marginBottom: 12,
    },
    headline: {
        fontFamily: DISPLAY,
        fontSize: 44,
        lineHeight: 42,
        letterSpacing: 1,
        color: CREAM,
    },
    subcopy: {
        fontFamily: BODY,
        fontSize: 15,
        lineHeight: 22,
        color: CREAM_DIM,
        marginTop: 14,
        maxWidth: 460,
    },

    // Features
    features: { marginTop: 28 },
    sectionLabel: {
        fontFamily: BODY_SEMI,
        fontSize: 11,
        letterSpacing: 2,
        color: CREAM_FAINT,
        marginBottom: 12,
    },
    featureRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 9,
    },
    featureIcon: { marginRight: 14 },
    featureText: {
        fontFamily: BODY_MED,
        fontSize: 15.5,
        color: CREAM,
    },

    // Plans
    plans: { marginTop: 28, gap: 12 },
    plansState: {
        paddingVertical: 24,
        alignItems: 'flex-start',
        gap: 12,
    },
    fine: { fontFamily: BODY, fontSize: 13, color: CREAM_DIM },
    errorText: { fontFamily: BODY_MED, fontSize: 14, color: CREAM },
    retryBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderWidth: 1,
        borderColor: CREAM_DIM,
        borderRadius: 12,
        paddingVertical: 10,
        paddingHorizontal: 18,
    },
    retryText: { fontFamily: BODY_SEMI, fontSize: 14, color: CREAM },
    devHint: { fontFamily: BODY, fontSize: 11, color: CREAM_FAINT, maxWidth: 320 },
    planCard: {
        borderWidth: 1.5,
        borderColor: HAIRLINE,
        borderRadius: 16,
        paddingVertical: 16,
        paddingHorizontal: 18,
    },
    planCardSelected: {
        backgroundColor: YELLOW,
        borderColor: YELLOW,
    },
    planTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 6,
    },
    planName: { fontFamily: BODY_SEMI, fontSize: 15, letterSpacing: 0.3 },
    badge: {
        backgroundColor: 'rgba(247, 246, 2, 0.16)',
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 3,
    },
    badgeSelected: { backgroundColor: NAVY },
    badgeText: { fontFamily: BODY_SEMI, fontSize: 10, letterSpacing: 0.5, color: YELLOW },
    planWeek: { fontFamily: BODY_SEMI, fontSize: 23, letterSpacing: 0.2 },
    planWeekUnit: { fontFamily: BODY_MED, fontSize: 13 },
    planBilled: { fontFamily: BODY, fontSize: 12.5, marginTop: 3 },

    // Footer
    restoreBtn: { marginTop: 22, alignSelf: 'flex-start' },
    restoreText: { fontFamily: BODY_MED, fontSize: 13, color: CREAM_DIM, textDecorationLine: 'underline' },
    legal: {
        fontFamily: BODY,
        fontSize: 10.5,
        lineHeight: 16,
        color: CREAM_FAINT,
        marginTop: 18,
    },
    legalLinks: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
    legalLink: { fontFamily: BODY_MED, fontSize: 11, color: CREAM_DIM, textDecorationLine: 'underline' },
    legalDot: { color: CREAM_FAINT, fontSize: 11 },

    // Sticky bar
    stickyBar: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: NAVY_RAISED,
        borderTopWidth: 1,
        borderTopColor: HAIRLINE,
        paddingHorizontal: 24,
        paddingTop: 14,
    },
    stickyTerms: {
        fontFamily: BODY,
        fontSize: 12,
        color: CREAM_DIM,
        textAlign: 'center',
        marginBottom: 10,
    },
    cta: {
        height: 56,
        borderRadius: 16,
        backgroundColor: YELLOW,
        justifyContent: 'center',
        alignItems: 'center',
    },
    ctaDisabled: { opacity: 0.55 },
    ctaText: { fontFamily: BODY_SEMI, fontSize: 16, color: NAVY, letterSpacing: 0.2 },
});
