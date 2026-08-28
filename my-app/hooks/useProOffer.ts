/**
 * Resolves what the paywall route should render: the standard $9.99 screen or
 * the conditional win-back.
 *
 * The decision itself is `shouldShowOffer` in lib/proOffer/eligibility.ts —
 * pure and tested. This hook only gathers the four inputs it needs (config,
 * grant, clock, live entitlement) and then loads the discounted offering.
 *
 * ── Every path out of here defaults to the standard paywall ─────────────────
 *
 * Config fetch fails, grant missing, offering absent from StoreKit, RevenueCat
 * unconfigured, kill switch off, user in the control arm: all of them return
 * `variant: 'standard'`. There is exactly one route to the win-back screen and
 * it requires every check to pass affirmatively. That asymmetry is deliberate —
 * the cost of wrongly showing the standard paywall is one missed discount, and
 * the cost of wrongly showing the win-back is a permanently discounted
 * subscriber who would have paid full price.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import Purchases, { INTRO_ELIGIBILITY_STATUS, type PurchasesPackage } from 'react-native-purchases';
import { useAuth } from '../providers/AuthProvider';
import { useSubscription } from '../providers/SubscriptionProvider';
import { track } from '../lib/analytics';
import { shouldShowOffer } from '../lib/proOffer/eligibility';
import {
    loadProOfferConfig,
    loadProOfferGrant,
    recordProOfferImpression,
} from '../lib/proOffer/client';
import { resolveOfferPricing, type OfferPricing } from '../lib/proOffer/pricing';
import { PRO_OFFER_CONFIG_FALLBACK } from '../lib/proOffer/types';
import type {
    DisplayDecision,
    ProOfferConfig,
    ProOfferGrant,
} from '../lib/proOffer/types';

/**
 * Is this Apple ID actually going to be charged the introductory price?
 *
 * `PPM02Winback` is $9.99/month base with a $6.99 introductory offer, and
 * Apple grants an introductory offer once per subscription group per Apple ID.
 * Eligibility rule A already excludes anyone whose Pawtchi account has ever
 * held the entitlement — and starting the free trial on ppm01 creates one — so
 * the two filters overlap almost completely.
 *
 * Almost. Entitlement history is per *Pawtchi account*; introductory
 * eligibility is per *Apple ID*. Someone who subscribed under one Apple ID and
 * later created a fresh Pawtchi account on the same device passes rule A and
 * fails Apple's check. Without this call they would be shown $6.99 and charged
 * $9.99 — a silent billing surprise, which is the worst class of bug to ship on
 * a payment screen.
 *
 * Returns false only on a definite INELIGIBLE or on UNKNOWN. Unknown is treated
 * as ineligible on purpose: we cannot promise a price we cannot confirm, and
 * the cost of being wrong in that direction is one missed discount.
 */
async function canGetIntroPrice(productId: string): Promise<boolean> {
    // Android is not asked. RevenueCat surfaces Play offers through
    // `subscriptionOptions`, which already contain only the phases this user
    // qualifies for, so the price read from them is the price charged. The
    // iOS-oriented eligibility API returns UNKNOWN there and would suppress the
    // offer on Android entirely.
    if (Platform.OS !== 'ios') return true;
    try {
        const result = await Purchases.checkTrialOrIntroductoryPriceEligibility([productId]);
        const status = result?.[productId]?.status;
        return (
            status === INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE ||
            // A SKU with no introductory offer at all is the 'flat' shape: the
            // base price is the price, so there is nothing to be ineligible for.
            status === INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_NO_INTRO_OFFER_EXISTS
        );
    } catch {
        return false;
    }
}

export type PaywallVariant = 'standard' | 'winback';

export interface ProOfferState {
    /** 'standard' until every check has affirmatively passed. */
    variant: PaywallVariant;
    /** False while config/grant/offering are still resolving. */
    resolved: boolean;
    grant: ProOfferGrant | null;
    config: ProOfferConfig;
    decision: DisplayDecision | null;
    /** The discounted package. Non-null only when variant is 'winback'. */
    offerPackage: PurchasesPackage | null;
    /** What that package actually costs, and for how long. Null unless 'winback'. */
    pricing: OfferPricing | null;
    expiresAt: Date | null;
    /** Shared property bag for every analytics event fired from the paywall. */
    analyticsProps: Record<string, string | number | boolean | null>;
    /** Burns an impression server-side. Call once, when the screen paints. */
    markShown: () => Promise<number>;
}

export function useProOffer(): ProOfferState {
    const { session } = useAuth();
    const { isPro, status, getOfferingById } = useSubscription();

    const [config, setConfig] = useState<ProOfferConfig>(PRO_OFFER_CONFIG_FALLBACK);
    const [grant, setGrant] = useState<ProOfferGrant | null>(null);
    const [offerPackage, setOfferPackage] = useState<PurchasesPackage | null>(null);
    const [pricing, setPricing] = useState<OfferPricing | null>(null);
    const [resolved, setResolved] = useState(false);

    const userId = session?.user?.id ?? null;

    useEffect(() => {
        let cancelled = false;

        // Signed out, or entitlement still loading. Resolving now would race
        // `status: 'loading'` and could paint the win-back screen to somebody
        // who turns out to be a subscriber a beat later.
        if (!userId || status === 'loading') {
            setResolved(false);
            return;
        }

        // A subscriber needs none of this fetched. Resolve immediately so the
        // paywall's existing "You're all set" branch paints without waiting on
        // two network calls it will never use.
        if (isPro) {
            setGrant(null);
            setOfferPackage(null);
            setPricing(null);
            setResolved(true);
            return;
        }

        (async () => {
            const [nextConfig, nextGrant] = await Promise.all([
                loadProOfferConfig(),
                loadProOfferGrant(userId),
            ]);
            if (cancelled) return;

            setConfig(nextConfig);
            setGrant(nextGrant);

            const decision = shouldShowOffer(nextGrant, nextConfig, {
                now: new Date(),
                isPro: false,
            });

            if (!decision.show) {
                setOfferPackage(null);
                setPricing(null);
                setResolved(true);
                return;
            }

            // Only now does the store get asked. Fetching the discounted
            // offering for everyone would be a wasted round trip on every
            // paywall open for the ~99% who are not eligible.
            const packages = await getOfferingById(nextConfig.offeringId);
            if (cancelled) return;

            // Every remaining way this can fail lands on the standard paywall
            // and says so out loud, with a distinct reason. A quiet failure here
            // reads as a negative experiment result rather than as the plumbing
            // gap it actually is.
            const unavailable = (reason: string) => {
                track('pro_offer_unavailable', {
                    reason,
                    offering_id: nextConfig.offeringId,
                    cohort: nextGrant?.cohort ?? null,
                    config_version: nextConfig.configVersion,
                });
                setOfferPackage(null);
                setPricing(null);
                setResolved(true);
            };

            // Not built yet, still in review, rejected, or Android without the
            // matching base plan.
            if (!packages || packages.length === 0) {
                unavailable('offering_missing');
                return;
            }

            const pkg = packages.find(p => p.packageType === 'MONTHLY') ?? packages[0];

            // What does this actually cost? PPM02Winback is $9.99 base with a
            // $6.99 introductory offer, so `priceString` alone would render the
            // full price as the discount.
            const nextPricing = resolveOfferPricing(pkg.product);
            if (!nextPricing) {
                unavailable('unpriceable');
                return;
            }

            // Confirm Apple will honour the introductory price for this Apple ID
            // before promising it. Skipped for the flat shape, where the base
            // price is the price and there is nothing to be ineligible for.
            if (nextPricing.shape === 'intro') {
                const eligible = await canGetIntroPrice(pkg.product.identifier);
                if (cancelled) return;
                if (!eligible) {
                    unavailable('intro_ineligible');
                    return;
                }
            }

            setOfferPackage(pkg);
            setPricing(nextPricing);
            setResolved(true);
        })();

        return () => {
            cancelled = true;
        };
    }, [userId, isPro, status, getOfferingById]);

    // Recomputed rather than stored, so a screen left open past the window's
    // end stops offering on the next render instead of holding a stale yes.
    const decision = useMemo(
        () => (resolved ? shouldShowOffer(grant, config, { now: new Date(), isPro }) : null),
        [resolved, grant, config, isPro],
    );

    // The offering AND a resolved price must both be in hand, not just the
    // decision. "Eligible but the SKU did not load", and "eligible but we
    // cannot say what it costs", are both a standard paywall — never a win-back
    // screen with a missing or wrong price on it.
    const variant: PaywallVariant =
        resolved && decision?.show && offerPackage && pricing ? 'winback' : 'standard';

    const expiresAt = useMemo(() => {
        if (!grant) return null;
        const t = Date.parse(grant.expiresAt);
        return Number.isFinite(t) ? new Date(t) : null;
    }, [grant]);

    const analyticsProps = useMemo(
        () => ({
            variant,
            cohort: grant?.cohort ?? null,
            offer_status: grant?.status ?? null,
            impression_index: decision?.impressionIndex ?? 0,
            days_left_in_window: decision?.daysLeftInWindow ?? 0,
            suppression_reason: decision?.reason ?? null,
            offering_id: config.offeringId,
            config_version: config.configVersion,
            product_id: offerPackage?.product.identifier ?? null,
            // The price actually charged now, not the base price. With an
            // introductory offer live these differ, and reporting the base
            // price would make every revenue-per-eligible-user calculation —
            // the experiment's primary metric — wrong by the size of the
            // discount, in the direction that flatters it.
            price: pricing?.offerPriceString ?? null,
            base_price: pricing?.basePriceString ?? null,
            offer_shape: pricing?.shape ?? null,
            intro_cycles: pricing?.introCycles ?? null,
            currency: offerPackage?.product.currencyCode ?? null,
        }),
        [variant, grant, decision, config, offerPackage, pricing],
    );

    // One impression per mount. Without this guard a re-render caused by the
    // offering resolving would spend a second impression on the same sighting.
    const markedRef = useRef(false);
    const markShown = useCallback(async () => {
        if (markedRef.current) return grant?.shownCount ?? 0;
        markedRef.current = true;
        const count = await recordProOfferImpression();
        setGrant(prev =>
            prev ? { ...prev, status: 'shown', shownCount: count || prev.shownCount } : prev,
        );
        return count;
    }, [grant?.shownCount]);

    return {
        variant,
        resolved,
        grant,
        config,
        decision,
        offerPackage,
        pricing,
        expiresAt,
        analyticsProps,
        markShown,
    };
}
