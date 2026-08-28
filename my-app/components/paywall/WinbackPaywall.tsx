/**
 * The conditional win-back paywall.
 *
 * Rendered only when every check in useProOffer passed: kill switch on, live
 * grant, variant cohort, window open, impressions left, spacing elapsed, not a
 * subscriber, and the discounted offering actually returned from the store.
 * Any one of those failing renders StandardPaywall instead.
 *
 * ── Two constraints that shape the whole layout ─────────────────────────────
 *
 * 1. **Both prices come from StoreKit.** The struck-through reference is the
 *    live `priceString` of the standard monthly package, and the offer price is
 *    the live `priceString` of the discounted one. Neither is ever a literal.
 *    This is not a style preference: a hardcoded price on a subscription screen
 *    is the store-compliance failure this app has already been rejected for
 *    once. If the reference price does not load, the reference line is omitted
 *    entirely rather than being filled in from memory.
 *
 * 2. **No sale language, no countdown.** No "% off", no "LAST CHANCE", no
 *    ticking clock. The expiry is stated once as a date, which it can be
 *    because the window is genuinely enforced server-side — that is the
 *    difference between information and pressure. Copy lives in
 *    lib/proOffer/copy.ts and is asserted against the brand spec in a test.
 *
 * There is deliberately no free-trial affordance here. A user reaching this
 * screen has usually already consumed the subscription group's one intro
 * offer, so offering a trial would be a promise the App Store then contradicts
 * at the purchase sheet.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { PurchasesPackage } from 'react-native-purchases';
import { makeShadow } from '../../constants/design';
import { PawLoader } from '../loader/PawLoader';
import { FailureModal } from '../FailureModal';
import { useActivePetStore } from '../../store/useActivePetStore';
import { useSubscription } from '../../hooks/useSubscription';
import { track, type AnalyticsProps } from '../../lib/analytics';
import { openManageSubscription } from '../../lib/manageSubscription';
import { BILLING_HELP_LABEL } from '../../lib/support/copy';
import { errorCopy, reportError, toAppError, type ErrorCopy } from '../../lib/appError';
import {
    recordPaywallInteraction,
    recordProOfferConversion,
} from '../../lib/proOffer/client';
import {
    OFFER_EYEBROW,
    OFFER_HEADLINE_ACCENT,
    OFFER_HEADLINE_LEAD,
    OFFER_PRICE_FOOTNOTE,
    OFFER_STANDARD_LABEL,
    offerCtaLabel,
    offerExpiryLine,
    offerLegalLine,
    offerSubcopy,
    offerTermLine,
} from '../../lib/proOffer/copy';
import type { OfferPricing } from '../../lib/proOffer/pricing';
import {
    NAVY,
    YELLOW,
    GRAY_500,
    GRAY_400,
    CHIP_BG,
    CHIP_BORDER,
    DISPLAY,
    BODY,
    BODY_MED,
    BODY_SEMI,
    BODY_BOLD,
    BODY_XB,
} from './theme';
import { ArrowIcon, BrandMark, CloseIcon, FEATURE_CHIPS } from './icons';

interface Props {
    offerPackage: PurchasesPackage;
    /** Resolved by lib/proOffer/pricing.ts — never read straight off the product. */
    pricing: OfferPricing;
    expiresAt: Date | null;
    /** Cohort, window and product context, shared by every event this screen fires. */
    analyticsProps: AnalyticsProps;
    /** Burns one server-side impression. Idempotent within the spacing window. */
    markShown: () => Promise<number>;
}

export function WinbackPaywall({
    offerPackage,
    pricing,
    expiresAt,
    analyticsProps,
    markShown,
}: Props) {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const activePet = useActivePetStore(s => s.activePet);
    const { purchasePackage, getOfferings, restorePurchases, isPro, isFreemiumActive } =
        useSubscription();

    const [purchasing, setPurchasing] = useState(false);
    const [failure, setFailure] = useState<ErrorCopy | null>(null);
    const [standardPrice, setStandardPrice] = useState<string | null>(null);

    // NOT `product.priceString` — that is the BASE price. PPM02Winback is
    // $9.99/month base with a $6.99 introductory offer, so reading the product
    // directly would render the full price as the discount.
    const offerPrice = pricing.offerPriceString;
    const productId = offerPackage.product.identifier;
    const isIntro = pricing.shape === 'intro' && !!pricing.introCycles && !!pricing.introUnit;

    // The struck-through reference price, for the 'flat' shape only.
    //
    // Under the introductory shape the price it reverts to IS the standard
    // price, so striking it through would say the $9.99 goes away when it comes
    // back in twelve months. The term line states the truth instead, and this
    // fetch is skipped entirely.
    useEffect(() => {
        if (isIntro) return;
        let cancelled = false;
        (async () => {
            try {
                const pkgs = await getOfferings();
                if (cancelled) return;
                const monthly = pkgs.find(p => p.packageType === 'MONTHLY') ?? pkgs[0];
                setStandardPrice(monthly?.product.priceString ?? null);
            } catch {
                // Omitted rather than guessed. A missing reference line is a
                // slightly less persuasive screen; a wrong one is a false price.
                setStandardPrice(null);
            }
        })();
        return () => { cancelled = true; };
    }, [getOfferings, isIntro]);

    // One impression, one view event, per mount.
    const seenRef = useRef(false);
    useEffect(() => {
        if (seenRef.current) return;
        seenRef.current = true;
        track('pro_offer_paywall_viewed', analyticsProps);
        // Same event name the standard screen fires, with variant: 'winback'.
        // Keeping one funnel is what makes the two presentations comparable.
        track('paywall_viewed', { ...analyticsProps, mode: 'winback' });
        recordPaywallInteraction('view', !isFreemiumActive);
        markShown();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const safeExit = useCallback(() => {
        if (router.canGoBack()) {
            router.back();
        } else {
            router.replace('/(tabs)' as any);
        }
    }, [router]);

    const handleDismiss = () => {
        track('pro_offer_paywall_dismissed', analyticsProps);
        track('paywall_dismissed', { ...analyticsProps, mode: 'winback' });
        recordPaywallInteraction('dismiss', !isFreemiumActive);
        safeExit();
    };

    const handlePurchase = async () => {
        if (isPro) {
            openManageSubscription();
            return;
        }
        setPurchasing(true);
        track('pro_offer_purchase_started', analyticsProps);
        track('paywall_purchase_started', { ...analyticsProps, plan: 'monthly', price: offerPrice });
        recordPaywallInteraction('purchase_started', !isFreemiumActive);
        try {
            const success = await purchasePackage(offerPackage);
            if (success) {
                // Measurement only — the entitlement from RevenueCat is what
                // actually grants access, and it has already been applied by
                // purchasePackage before this line runs.
                recordProOfferConversion(productId);
                track('pro_offer_purchase_succeeded', analyticsProps);
                track('paywall_purchase_succeeded', {
                    ...analyticsProps,
                    plan: 'monthly',
                    price: offerPrice,
                });
                safeExit();
            } else {
                // Cancelled at the store sheet. The window stays open — this
                // was not a refusal of the offer, it was a closed dialog.
                track('paywall_purchase_cancelled', { ...analyticsProps, plan: 'monthly' });
            }
        } catch (e: unknown) {
            const appErr = toAppError(e);
            appErr.kind = 'purchase';
            reportError(appErr, 'purchase');
            track('pro_offer_purchase_failed', {
                ...analyticsProps,
                reason: e instanceof Error ? e.message : 'exception',
            });
            track('paywall_purchase_failed', {
                ...analyticsProps,
                reason: e instanceof Error ? e.message : 'exception',
            });
            setFailure(errorCopy(appErr, { context: 'purchase' }));
        } finally {
            setPurchasing(false);
        }
    };

    return (
        <View style={styles.container}>
            <StatusBar style="dark" />

            <TouchableOpacity
                style={[styles.closeBtn, { top: insets.top + 8 }]}
                onPress={handleDismiss}
                activeOpacity={0.7}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
                <CloseIcon />
            </TouchableOpacity>

            <ScrollView
                contentContainerStyle={[
                    styles.scroll,
                    { paddingTop: insets.top + 64, paddingBottom: insets.bottom + 28 },
                ]}
                showsVerticalScrollIndicator={false}
            >
                <Animated.View entering={FadeInDown.duration(450)} style={styles.content}>
                    <View style={styles.brandPill}>
                        <View style={styles.brandIcon}>
                            <BrandMark />
                        </View>
                        <Text style={styles.brandLabel}>{OFFER_EYEBROW}</Text>
                    </View>

                    <View style={styles.headlineWrap}>
                        <Text style={styles.headlineDisplay}>{OFFER_HEADLINE_LEAD} </Text>
                        <View style={styles.highlightWrap}>
                            <View style={styles.highlightBar} />
                            <Text style={styles.headlineDisplay}>{OFFER_HEADLINE_ACCENT}</Text>
                        </View>
                        <Text style={styles.headlineDisplay}>.</Text>
                    </View>

                    <Text style={styles.subcopy}>
                        {offerSubcopy({ name: activePet?.name, gender: activePet?.gender })}
                    </Text>

                    {/* ─── Price block ─── */}
                    <View style={styles.priceCard}>
                        {/* Flat shape only: a reference price that genuinely
                            goes away. Under an introductory offer it does not. */}
                        {!isIntro && standardPrice && (
                            <>
                                <Text style={styles.standardLabel}>{OFFER_STANDARD_LABEL}</Text>
                                <Text style={styles.standardPrice}>{standardPrice}/month</Text>
                            </>
                        )}
                        <Text style={styles.offerPrice}>{offerPrice}/month</Text>
                        <Text style={styles.priceFootnote}>
                            {isIntro
                                ? offerTermLine(
                                      pricing.introCycles!,
                                      pricing.introUnit!,
                                      pricing.basePriceString,
                                  )
                                : OFFER_PRICE_FOOTNOTE}
                        </Text>
                    </View>

                    <TouchableOpacity
                        onPress={handlePurchase}
                        disabled={purchasing}
                        activeOpacity={0.9}
                        style={{ width: '100%' }}
                    >
                        <View style={[styles.cta, purchasing && styles.ctaDisabled]}>
                            <View style={styles.ctaInner}>
                                <Text style={styles.ctaText}>{offerCtaLabel(offerPrice)}</Text>
                                <ArrowIcon />
                            </View>
                        </View>
                    </TouchableOpacity>

                    {/* Both stores require the introductory term and the price
                        it reverts to on the purchase screen, and the brand spec
                        would require saying it anyway. */}
                    <Text style={styles.legal}>
                        {offerLegalLine(
                            offerPrice,
                            isIntro
                                ? {
                                      cycles: pricing.introCycles!,
                                      unit: pricing.introUnit!,
                                      basePriceString: pricing.basePriceString,
                                  }
                                : null,
                        )}
                    </Text>
                    {expiresAt && (
                        <Text style={styles.expiry}>{offerExpiryLine(expiresAt)}</Text>
                    )}

                    <View style={styles.chips}>
                        {FEATURE_CHIPS.map(({ label, Icon }) => (
                            <View key={label} style={styles.chip}>
                                <Icon />
                                <Text style={styles.chipLabel}>{label}</Text>
                            </View>
                        ))}
                    </View>

                    <View style={styles.footerLinks}>
                        <TouchableOpacity
                            onPress={() => {
                                track('paywall_restore_tapped', analyticsProps);
                                restorePurchases();
                            }}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                            <Text style={styles.footerLink}>Restore purchase</Text>
                        </TouchableOpacity>
                        <Text style={styles.footerDot}>·</Text>
                        <TouchableOpacity onPress={() => router.push('/privacy')}>
                            <Text style={styles.footerLink}>Privacy</Text>
                        </TouchableOpacity>
                        <Text style={styles.footerDot}>·</Text>
                        {/* Not optional. Both stores require a link to the terms
                            of use on any screen that sells a subscription, and
                            this screen sells one. Same destination as the
                            standard paywall — nothing new is being published. */}
                        <TouchableOpacity onPress={() => Linking.openURL('https://pawtchi.com/terms')}>
                            <Text style={styles.footerLink}>Terms</Text>
                        </TouchableOpacity>
                        <Text style={styles.footerDot}>·</Text>
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
            </ScrollView>

            <PawLoader visible={purchasing} message="Processing…" />

            {/* FailureModal owns contact support, settings and back — before it
                existed, "Contact support" here just closed the sheet. */}
            <FailureModal
                copy={failure}
                onClose={() => setFailure(null)}
                onAction={(action) => { if (action === 'retry') handlePurchase(); }}
                meta={{ kind: 'purchase', context: 'purchase', screen: '/paywall' }}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#ffffff',
    },
    scroll: {
        flexGrow: 1,
        justifyContent: 'center',
        paddingHorizontal: 28,
    },
    content: {
        alignItems: 'center',
        width: '100%',
    },

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

    brandPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 14,
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

    headlineWrap: {
        flexDirection: 'row',
        alignItems: 'baseline',
        flexWrap: 'wrap',
        justifyContent: 'center',
        marginBottom: 12,
    },
    headlineDisplay: {
        fontFamily: DISPLAY,
        fontSize: 42,
        lineHeight: 44,
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
        height: 15,
        backgroundColor: YELLOW,
        transform: [{ skewX: '-8deg' }],
    },

    subcopy: {
        fontFamily: BODY,
        fontSize: 14,
        lineHeight: 21,
        color: GRAY_500,
        textAlign: 'center',
        maxWidth: 310,
        marginBottom: 24,
    },

    // ─── Price block ───
    // Hairline rules above and below rather than a filled card: the price is
    // the loudest thing on this screen and it should not have to compete with
    // a background as well.
    priceCard: {
        alignItems: 'center',
        alignSelf: 'stretch',
        borderTopWidth: 1,
        borderBottomWidth: 1,
        borderColor: CHIP_BORDER,
        paddingVertical: 20,
        marginBottom: 24,
    },
    standardLabel: {
        fontFamily: BODY_SEMI,
        fontSize: 10,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
        color: GRAY_400,
        marginBottom: 4,
    },
    standardPrice: {
        fontFamily: BODY_MED,
        fontSize: 15,
        color: GRAY_400,
        textDecorationLine: 'line-through',
        marginBottom: 8,
    },
    offerPrice: {
        fontFamily: DISPLAY,
        fontSize: 40,
        lineHeight: 42,
        letterSpacing: 0.5,
        color: NAVY,
    },
    priceFootnote: {
        fontFamily: BODY,
        fontSize: 12,
        color: GRAY_500,
        marginTop: 6,
        textAlign: 'center',
    },

    cta: {
        width: '100%',
        backgroundColor: YELLOW,
        borderRadius: 18,
        paddingVertical: 20,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 10,
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

    legal: {
        fontFamily: BODY,
        fontSize: 11,
        color: GRAY_400,
        textAlign: 'center',
        lineHeight: 15.4,
    },
    // One line, one date. Not a timer — the window is real, so saying when it
    // ends is information rather than pressure.
    expiry: {
        fontFamily: BODY_MED,
        fontSize: 11,
        color: GRAY_500,
        textAlign: 'center',
        marginTop: 4,
    },

    chips: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: 6,
        marginTop: 20,
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

    footerLinks: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 20,
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
});
