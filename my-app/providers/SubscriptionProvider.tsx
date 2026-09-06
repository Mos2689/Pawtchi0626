import React, {
    createContext,
    useContext,
    useState,
    useEffect,
    useCallback,
    useMemo,
    useRef,
    ReactNode,
} from 'react';
import { Platform } from 'react-native';
import Purchases, { CustomerInfo, PurchasesPackage, PURCHASES_ERROR_CODE } from 'react-native-purchases';
import { useAuth } from './AuthProvider';
import { trackFirebaseEvent } from '../lib/firebaseAnalytics';
import { track } from '../lib/analytics';
import { recordEntitlementSeen, revokeProOffer } from '../lib/proOffer/client';

// Subscription status types
export type SubscriptionStatus = 'loading' | 'trial' | 'active' | 'expired' | 'none';

interface SubscriptionState {
    status: SubscriptionStatus;
    daysLeft: number | null;
    isTrialActive: boolean;
    isPro: boolean;
    daysSinceCreation: number;
    isFreemiumActive: boolean;
    hasFullAccess: boolean;
    /**
     * Access came from a RevenueCat *promotional* entitlement — a creator code,
     * or a comp we granted — rather than from a purchase.
     *
     * Surfaces need this because `isPro` has always implied "has a store
     * subscription", and two screens act on that: the paywall offers "Manage
     * subscription", and the membership card counts down a billing period.
     * Neither exists behind a granted entitlement, so both would send someone
     * to an empty App Store page or tell them about a renewal that will never
     * happen.
     */
    isPromoAccess: boolean;
    /**
     * When the active entitlement ends, as a date rather than `daysLeft`'s
     * count. Granted access is described by when it stops ("open until 6
     * December"), which is a fact a person can plan around; "92 days left" is
     * arithmetic they have to do themselves.
     */
    expiresAt: Date | null;
}

export interface SubscriptionContextValue extends SubscriptionState {
    restorePurchases: () => Promise<void>;
    purchasePackage: (pkg: PurchasesPackage) => Promise<boolean>;
    getOfferings: () => Promise<PurchasesPackage[]>;
    /** A named offering's packages, or null when it is not available on this store. */
    getOfferingById: (offeringId: string) => Promise<PurchasesPackage[] | null>;
    refresh: (options?: SubscriptionRefreshOptions) => Promise<boolean>;
    /**
     * Reflect a successful server-side promotional grant immediately. RevenueCat
     * can briefly return its previous cached CustomerInfo after a grant, so this
     * keeps the rest of the app from lagging behind the success screen.
     */
    activatePromotionalAccess: (expiresAt: Date) => void;
}

interface SubscriptionRefreshOptions {
    invalidateCache?: boolean;
    preserveAccessOnMiss?: boolean;
}

const ENTITLEMENT_ID = 'Pawtchi Pro'; // Must match the RevenueCat entitlement identifier
const FREEMIUM_DAYS = 30; // Everyone gets full access for this many days — no gating before it elapses

const SubscriptionContext = createContext<SubscriptionContextValue | undefined>(undefined);

// Single source of truth for subscription/entitlement state. Mount once near the app
// root (inside AuthProvider) so detection runs exactly one time and every screen reads
// the same state via `useSubscription()`.
export function SubscriptionProvider({ children }: { children: ReactNode }) {
    const { session } = useAuth();

    // Default to full access so we NEVER gate before the live state is known.
    const [state, setState] = useState<SubscriptionState>({
        status: 'loading',
        daysLeft: null,
        isTrialActive: false,
        isPro: false,
        daysSinceCreation: 0,
        isFreemiumActive: true,
        hasFullAccess: true,
        isPromoAccess: false,
        expiresAt: null,
    });

    // Fires the pro-offer entitlement mirror at most once per mount. The RC
    // listener re-delivers CustomerInfo on every refresh, and two RPCs per
    // foreground is noise for a write-once column.
    const entitlementMirroredRef = useRef(false);
    // Set only after the redemption edge function confirms a grant. RevenueCat
    // can emit one older CustomerInfo snapshot while its promotional
    // entitlement propagates; this prevents that listener event from undoing
    // the success the server has already confirmed.
    const promotionalGrantRef = useRef<Date | null>(null);

    // Translate a RevenueCat CustomerInfo snapshot into our state.
    // Access rule: a subscriber always has access; everyone else has full access for the
    // first FREEMIUM_DAYS days (no gating in that window), then is gated.
    const processCustomerInfo = useCallback(
        (customerInfo: CustomerInfo) => {
            let daysSinceCreation = 0;
            let isFreemiumActive = true; // fail open if we can't determine account age
            if (session?.user?.created_at) {
                const createdAt = new Date(session.user.created_at);
                daysSinceCreation = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
                isFreemiumActive = daysSinceCreation <= FREEMIUM_DAYS;
            }

            const entitlement = customerInfo.entitlements.active[ENTITLEMENT_ID];

            if (
                !entitlement &&
                promotionalGrantRef.current &&
                promotionalGrantRef.current.getTime() > Date.now()
            ) {
                return;
            }
            if (entitlement) promotionalGrantRef.current = null;

            // The win-back offer is for people who have NEVER subscribed, so
            // any entitlement — active or lapsed — permanently disqualifies
            // this account and closes any open offer.
            //
            // This runs here rather than in the paywall because the case it
            // exists for is buying on a second device: the discount window has
            // to close whether or not this device's owner ever opens the
            // paywall again. Best-effort by design; the live `isPro` check in
            // useProOffer is what actually keeps the screen away from a payer.
            //
            // Promotional entitlements are excluded, and that exclusion is
            // load-bearing rather than tidy. A creator code — and the year we
            // comp a creator so they can film the paid features — arrives here
            // as an entitlement like any other. Counting it as "has subscribed"
            // would permanently disqualify every one of those people from the
            // win-back offer, and would report every creator as their own
            // converted customer in get_creator_code_stats(), where
            // `converted_to_paid` reads this exact column. The number that
            // decides whether a collaboration gets renewed would be the number
            // of people we gave it to for nothing.
            const allEntitlement = customerInfo.entitlements.all[ENTITLEMENT_ID];
            const everEntitled = !!allEntitlement && allEntitlement.store !== 'PROMOTIONAL';
            if (everEntitled && !entitlementMirroredRef.current) {
                entitlementMirroredRef.current = true;
                recordEntitlementSeen();
                revokeProOffer(entitlement ? 'subscribed' : 'previously_subscribed');
            }

            if (entitlement) {
                const isTrial = entitlement.periodType === 'TRIAL';
                const expirationDate = entitlement.expirationDate ? new Date(entitlement.expirationDate) : null;
                const daysLeft = expirationDate
                    ? Math.ceil((expirationDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                    : null;

                setState({
                    status: isTrial ? 'trial' : 'active',
                    daysLeft,
                    isTrialActive: isTrial,
                    isPro: true,
                    daysSinceCreation,
                    isFreemiumActive,
                    hasFullAccess: true, // a subscriber always has access
                    isPromoAccess: entitlement.store === 'PROMOTIONAL',
                    expiresAt: expirationDate,
                });
            } else {
                // Distinguish "subscription lapsed" from "never subscribed".
                // A creator's three months running out lands here too, and
                // 'expired' is the right answer for them: they did have Plus,
                // and it did end.
                const hasExpired = allEntitlement && !allEntitlement.isActive;

                setState({
                    status: hasExpired ? 'expired' : 'none',
                    daysLeft: 0,
                    isTrialActive: false,
                    isPro: false,
                    daysSinceCreation,
                    isFreemiumActive,
                    // No gating during the first 30 days; gated only once freemium has elapsed.
                    hasFullAccess: isFreemiumActive,
                    isPromoAccess: false,
                    expiresAt: null,
                });
            }
        },
        [session?.user?.created_at],
    );

    // Keep a live ref so the listener and purchase/restore callbacks always run the
    // latest processor (with the current session) without re-subscribing the listener.
    const processRef = useRef(processCustomerInfo);
    useEffect(() => {
        processRef.current = processCustomerInfo;
    }, [processCustomerInfo]);

    useEffect(() => {
        // A different account signing in on this device is a different
        // entitlement history. Without this reset the mirror would stay latched
        // from the previous user and the new one's offer would never be
        // revoked — the same shape of cross-account leak the notification
        // centre's runtimeItems reset exists to prevent.
        entitlementMirroredRef.current = false;
        promotionalGrantRef.current = null;

        // RevenueCat is configured in the layout effect, which can run after this provider
        // mounts. Rather than bail when not configured, poll briefly until it is, then
        // attach the listener and read the live entitlement — removing the race that left
        // already-subscribed users unrecognized.
        let cancelled = false;
        let listenerCb: ((info: CustomerInfo) => void) | null = null;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        let attempts = 0;
        const MAX_ATTEMPTS = 15; // ~6s; in Expo Go RC never configures, so we stop quietly

        const attach = async () => {
            if (cancelled) return;
            try {
                const configured = await Purchases.isConfigured();
                if (!configured) {
                    if (attempts++ < MAX_ATTEMPTS && !cancelled) {
                        retryTimer = setTimeout(attach, 400);
                    }
                    return;
                }

                if (!listenerCb) {
                    try {
                        listenerCb = (info: CustomerInfo) => {
                            if (!cancelled) processRef.current(info);
                        };
                        Purchases.addCustomerInfoUpdateListener(listenerCb);
                    } catch (e) {
                        console.warn('RevenueCat listener attach failed:', e);
                        listenerCb = null;
                    }
                }

                // Android: reconcile Google Play purchases to the current app user.
                if (Platform.OS === 'android') {
                    try {
                        await Purchases.syncPurchases();
                    } catch {
                        // best-effort
                    }
                }

                const customerInfo = await Purchases.getCustomerInfo();
                if (!cancelled) processRef.current(customerInfo);
            } catch (e: any) {
                if (e?.message && String(e.message).includes('singleton')) {
                    if (attempts++ < MAX_ATTEMPTS && !cancelled) {
                        retryTimer = setTimeout(attach, 400);
                    }
                    return;
                }
                console.error('RevenueCat getCustomerInfo error:', e);
                // Fail open so a transient error never locks users out.
                if (!cancelled) {
                    setState((prev) => ({
                        ...prev,
                        status: 'active',
                        daysLeft: null,
                        isTrialActive: false,
                        isPro: true,
                        hasFullAccess: true,
                        // Cleared rather than carried over from `prev`. We are
                        // claiming access without evidence, and the promo
                        // surfaces render an end date — carrying a stale flag
                        // here would put "open until <no date>" on the card.
                        isPromoAccess: false,
                        expiresAt: null,
                    }));
                }
            }
        };

        attach();

        return () => {
            cancelled = true;
            if (retryTimer) clearTimeout(retryTimer);
            if (listenerCb) {
                try {
                    Purchases.removeCustomerInfoUpdateListener(listenerCb);
                } catch {
                    // best-effort
                }
            }
        };
        // Re-run when the identified user changes so entitlements reload after logIn.
    }, [session?.user?.id]);

    const restorePurchases = useCallback(async () => {
        try {
            if (!(await Purchases.isConfigured())) return;
            const customerInfo = await Purchases.restorePurchases();
            processRef.current(customerInfo);
        } catch (e) {
            console.error('Restore error:', e);
        }
    }, []);

    const purchasePackage = useCallback(async (pkg: PurchasesPackage): Promise<boolean> => {
        try {
            if (!(await Purchases.isConfigured())) return false;
            const { customerInfo, productIdentifier, transaction } = await Purchases.purchasePackage(pkg);
            processRef.current(customerInfo);

            const entitlement = customerInfo.entitlements.active[ENTITLEMENT_ID];
            const isVerified =
                entitlement?.verification === 'VERIFIED' ||
                entitlement?.verification === 'VERIFIED_ON_DEVICE';

            // The RevenueCat response is the confirmation boundary. Firebase
            // receives no customer or pet data—only the approved value fields.
            if (entitlement && isVerified) {
                if (entitlement.periodType === 'TRIAL') {
                    trackFirebaseEvent('trial_started');
                } else {
                    trackFirebaseEvent('purchase', {
                        transaction_id: transaction.transactionIdentifier,
                        currency: pkg.product.currencyCode,
                        value: pkg.product.price,
                        product_id: productIdentifier,
                    });
                }
            } else if (entitlement) {
                // Sold, granted, and NOT reported to Google Ads. Verification
                // runs in informational mode, so an unverified entitlement is
                // invisible everywhere else — the user is subscribed and the app
                // behaves normally. Without this line the only symptom would be
                // conversions quietly missing from Ads with nothing to point at.
                track('purchase_conversion_unverified', {
                    verification: entitlement.verification ?? 'unknown',
                    period_type: entitlement.periodType,
                });
            }
            return true;
        } catch (e: any) {
            if (e?.userCancelled) {
                return false;
            }
            // The user already owns this subscription (e.g. Play "ITEM_ALREADY_OWNED").
            // Recover by syncing/restoring and reading the live entitlement.
            const alreadyOwned =
                e?.code === PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR ||
                (typeof e?.message === 'string' && /already (own|subscrib|purchas)/i.test(e.message));
            if (alreadyOwned) {
                try {
                    if (Platform.OS === 'android') {
                        await Purchases.syncPurchases();
                    }
                    const info = await Purchases.getCustomerInfo();
                    processRef.current(info);
                    if (info.entitlements.active[ENTITLEMENT_ID]) {
                        return true;
                    }
                    const restored = await Purchases.restorePurchases();
                    processRef.current(restored);
                    return !!restored.entitlements.active[ENTITLEMENT_ID];
                } catch (recoverErr) {
                    console.warn('Already-owned recovery failed:', recoverErr);
                    // Treat as success to avoid trapping a genuine owner in a buy loop.
                    return true;
                }
            }
            console.error('Purchase error:', e);
            return false;
        }
    }, []);

    const getOfferings = useCallback(async (): Promise<PurchasesPackage[]> => {
        try {
            if (!(await Purchases.isConfigured())) return [];
            const offerings = await Purchases.getOfferings();
            if (offerings.current) {
                return offerings.current.availablePackages;
            }
            return [];
        } catch (e) {
            console.error('Offerings error:', e);
            return [];
        }
    }, []);

    // A specific, non-current offering by identifier — how the win-back paywall
    // reaches the discounted SKU without disturbing `current`, which the
    // standard paywall reads and which must keep meaning "the normal price".
    //
    // Returns null rather than falling back to `current` on a miss. A silent
    // fallback here would render the win-back screen's discount framing around
    // the full price, which is the one failure mode worse than showing nothing:
    // the caller treats null as "show the standard paywall instead".
    const getOfferingById = useCallback(
        async (offeringId: string): Promise<PurchasesPackage[] | null> => {
            try {
                if (!(await Purchases.isConfigured())) return null;
                const offerings = await Purchases.getOfferings();
                const offering = offerings.all?.[offeringId];
                if (!offering || offering.availablePackages.length === 0) return null;
                return offering.availablePackages;
            } catch (e) {
                console.warn('Offering lookup failed:', offeringId, e);
                return null;
            }
        },
        [],
    );

    const activatePromotionalAccess = useCallback((expiresAt: Date) => {
        promotionalGrantRef.current = expiresAt;
        const daysLeft = Math.max(
            1,
            Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
        );

        setState((prev) => ({
            ...prev,
            status: 'active',
            daysLeft,
            isTrialActive: false,
            isPro: true,
            hasFullAccess: true,
            isPromoAccess: true,
            expiresAt,
        }));
    }, []);

    const refresh = useCallback(async (options: SubscriptionRefreshOptions = {}): Promise<boolean> => {
        try {
            if (!(await Purchases.isConfigured())) return false;
            if (options.invalidateCache) {
                await Purchases.invalidateCustomerInfoCache();
            }
            if (Platform.OS === 'android' && !options.preserveAccessOnMiss) {
                try {
                    await Purchases.syncPurchases();
                } catch {
                    // best-effort
                }
            }
            const info = await Purchases.getCustomerInfo();
            const hasActiveEntitlement = !!info.entitlements.active[ENTITLEMENT_ID];
            // A just-granted entitlement may take a moment to appear even after
            // invalidating RevenueCat's device cache. Do not replace the
            // server-confirmed access with that stale miss while it settles.
            if (hasActiveEntitlement || !options.preserveAccessOnMiss) {
                processRef.current(info);
            }
            return hasActiveEntitlement;
        } catch (e) {
            console.warn('Subscription refresh failed:', e);
            return false;
        }
    }, []);

    const value = useMemo<SubscriptionContextValue>(
        () => ({
            ...state,
            restorePurchases,
            purchasePackage,
            getOfferings,
            getOfferingById,
            refresh,
            activatePromotionalAccess,
        }),
        [
            state,
            restorePurchases,
            purchasePackage,
            getOfferings,
            getOfferingById,
            refresh,
            activatePromotionalAccess,
        ],
    );

    return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

export function useSubscription(): SubscriptionContextValue {
    const ctx = useContext(SubscriptionContext);
    if (!ctx) {
        throw new Error('useSubscription must be used within a SubscriptionProvider');
    }
    return ctx;
}
