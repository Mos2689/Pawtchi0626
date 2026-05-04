import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Image,
    ScrollView,
    ActivityIndicator,
    Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { PurchasesPackage } from 'react-native-purchases';
import { useActivePetStore } from '../store/useActivePetStore';
import { useSubscription } from '../hooks/useSubscription';

// ─── Paywall Modes ───
// welcome  → Post-onboarding, first encounter. Warm, generous, gift-like.
// upgrade  → Mid-freemium window. Appreciative, confident, gentle nudge.
// renewal  → Post-expiry or lapsed subscriber. Emotional, loss aversion.
type PaywallMode = 'welcome' | 'upgrade' | 'renewal';

function deriveMode(
    status: string,
    isFreemiumActive: boolean,
    daysSinceCreation: number,
): PaywallMode {
    // Just finished onboarding (first day or two)
    if (daysSinceCreation <= 1 && (status === 'none' || status === 'loading')) {
        return 'welcome';
    }
    // Mid-freemium window — still has free access
    if (isFreemiumActive && status !== 'expired') {
        return 'upgrade';
    }
    // Everything else: expired sub, or freemium window is over
    return 'renewal';
}

// ─── Mode-specific content ───
interface ModeContent {
    emoji: string;
    title: (petName: string, parentTitle: string) => string;
    subtitle: (petName: string, daysLeft: number) => string;
    ctaLabel: (price: string) => string;
    dismissLabel: string;
    showDismiss: boolean;
    heroColors: [string, string, string];
}

const MODE_CONFIG: Record<PaywallMode, ModeContent> = {
    welcome: {
        emoji: '🎉',
        title: (_pet, _parent) => 'Welcome to\nPawtchi Premium!',
        subtitle: (petName, _daysLeft) =>
            `Enjoy 30 days of full access — free, on us.\nWe want you and ${petName} to fall in love with the experience first.`,
        ctaLabel: (price) => `Start Free Month — then ${price}`,
        dismissLabel: 'Maybe Later',
        showDismiss: true,
        heroColors: ['#041015', '#0c2a1a', '#041015'],
    },
    upgrade: {
        emoji: '✨',
        title: (petName, _parent) => `Loving Pawtchi,\n${petName}?`,
        subtitle: (_petName, daysLeft) =>
            `${daysLeft} day${daysLeft !== 1 ? 's' : ''} of free access remaining.\nSubscribe now to keep everything unlocked — your data, your streaks, your AI insights.`,
        ctaLabel: (price) => `Continue with Premium — ${price}`,
        dismissLabel: 'Not Yet',
        showDismiss: true,
        heroColors: ['#041015', '#1a1a2e', '#041015'],
    },
    renewal: {
        emoji: '🥺',
        title: (_pet, parentTitle) => `I'll miss you,\n${parentTitle}...`,
        subtitle: (petName, _daysLeft) =>
            `${petName}'s data is safe, but premium features are paused.\nSubscribe to pick up where you left off.`,
        ctaLabel: (price) => `Reactivate Premium — ${price}`,
        dismissLabel: '',
        showDismiss: false,
        heroColors: ['#041015', '#0a1a22', '#041015'],
    },
};

export default function PaywallScreen() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { activePet } = useActivePetStore();
    const {
        restorePurchases,
        purchasePackage,
        getOfferings,
        status,
        isFreemiumActive,
        daysSinceCreation,
    } = useSubscription();
    const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'yearly'>('yearly');
    const [purchasing, setPurchasing] = useState(false);
    const [packages, setPackages] = useState<PurchasesPackage[]>([]);

    const petName = activePet?.name || 'Your Pet';
    const parentTitle = activePet?.parent_title || 'Mom/Dad';
    const petImage =
        activePet?.image_url ||
        'https://images.unsplash.com/photo-1587300003388-59208cc962cb?q=80&w=1000&auto=format&fit=crop';

    // ─── Auto-detect mode ───
    const mode = deriveMode(status, isFreemiumActive, daysSinceCreation);
    const config = MODE_CONFIG[mode];
    const freemiumDaysLeft = Math.max(0, 30 - daysSinceCreation);

    // Load offerings on mount
    useEffect(() => {
        (async () => {
            const pkgs = await getOfferings();
            setPackages(pkgs);
        })();
    }, [getOfferings]);

    // Package helpers
    const yearlyPkg = packages.find((p) => p.packageType === 'ANNUAL');
    const monthlyPkg = packages.find((p) => p.packageType === 'MONTHLY');
    const yearlyPrice = yearlyPkg?.product.priceString ?? 'AUD $49.99';
    const monthlyPrice = monthlyPkg?.product.priceString ?? 'AUD $4.99';
    const selectedPkg = selectedPlan === 'yearly' ? yearlyPkg : monthlyPkg;
    const selectedPrice = selectedPlan === 'yearly' ? yearlyPrice : monthlyPrice;

    const handlePurchase = async () => {
        setPurchasing(true);
        try {
            const pkg = selectedPkg || packages[0];
            if (pkg) {
                const success = await purchasePackage(pkg);
                if (success) {
                    router.back();
                }
            } else {
                Alert.alert('No plans available', 'Please try again later.');
            }
        } catch (e) {
            console.error('Purchase error:', e);
        } finally {
            setPurchasing(false);
        }
    };

    const features = [
        { icon: 'camera-alt' as const, text: 'AI-powered food scanning' },
        { icon: 'directions-run' as const, text: 'Activity & walk tracking' },
        { icon: 'monitor-heart' as const, text: 'Weekly health insights' },
        { icon: 'notifications-active' as const, text: 'Smart pet reminders' },
        { icon: 'medical-services' as const, text: 'Vet report analysis' },
        { icon: 'auto-graph' as const, text: 'Calorie & nutrition trends' },
    ];

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            {/* Close / dismiss — only for welcome & upgrade modes */}
            {config.showDismiss && (
                <TouchableOpacity
                    style={[styles.closeButton, { top: insets.top + 12 }]}
                    onPress={() => router.back()}
                    activeOpacity={0.7}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                    <MaterialIcons name="close" size={24} color="#64748b" />
                </TouchableOpacity>
            )}

            <ScrollView
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                bounces={false}
            >
                {/* ═══ Hero Section ═══ */}
                <View style={styles.heroSection}>
                    <LinearGradient
                        colors={config.heroColors}
                        style={styles.heroGradient}
                    >
                        {/* Glow */}
                        <View
                            style={[
                                styles.glowCircle,
                                mode === 'welcome' && { backgroundColor: 'rgba(74, 222, 128, 0.12)' },
                                mode === 'upgrade' && { backgroundColor: 'rgba(255, 252, 0, 0.12)' },
                                mode === 'renewal' && { backgroundColor: 'rgba(255, 252, 0, 0.08)' },
                            ]}
                        />

                        {/* Pet image */}
                        <View
                            style={[
                                styles.petImageWrapper,
                                mode === 'welcome' && { borderColor: 'rgba(74, 222, 128, 0.5)' },
                                mode === 'upgrade' && { borderColor: 'rgba(255, 252, 0, 0.4)' },
                                mode === 'renewal' && { borderColor: 'rgba(255, 252, 0, 0.25)' },
                            ]}
                        >
                            <Image source={{ uri: petImage }} style={styles.petImage} />
                        </View>

                        {/* Emoji */}
                        <Text style={styles.emoji}>{config.emoji}</Text>

                        {/* Title */}
                        <Text style={[
                            styles.heroTitle,
                            mode === 'welcome' && { color: '#4ade80' },
                        ]}>
                            {config.title(petName, parentTitle)}
                        </Text>

                        {/* Subtitle */}
                        <Text style={styles.heroSubtitle}>
                            {config.subtitle(petName, freemiumDaysLeft)}
                        </Text>

                        {/* Welcome mode: extra trust signals */}
                        {mode === 'welcome' && (
                            <View style={styles.trustRow}>
                                <View style={styles.trustPill}>
                                    <MaterialIcons name="check-circle" size={14} color="#4ade80" />
                                    <Text style={styles.trustText}>No payment now</Text>
                                </View>
                                <View style={styles.trustPill}>
                                    <MaterialIcons name="check-circle" size={14} color="#4ade80" />
                                    <Text style={styles.trustText}>Cancel anytime</Text>
                                </View>
                                <View style={styles.trustPill}>
                                    <MaterialIcons name="check-circle" size={14} color="#4ade80" />
                                    <Text style={styles.trustText}>Full access</Text>
                                </View>
                            </View>
                        )}

                        {/* Upgrade mode: countdown pill */}
                        {mode === 'upgrade' && freemiumDaysLeft > 0 && (
                            <View style={styles.countdownPill}>
                                <MaterialIcons name="schedule" size={14} color="#fbbf24" />
                                <Text style={styles.countdownText}>
                                    {freemiumDaysLeft} day{freemiumDaysLeft !== 1 ? 's' : ''} remaining
                                </Text>
                            </View>
                        )}
                    </LinearGradient>
                </View>

                {/* ═══ Plan Cards ═══ */}
                <View style={styles.plansSection}>
                    <Text style={styles.plansTitle}>
                        {mode === 'welcome' ? 'After Your Free Month' : 'Choose Your Plan'}
                    </Text>

                    {/* Yearly */}
                    <TouchableOpacity
                        activeOpacity={0.85}
                        onPress={() => setSelectedPlan('yearly')}
                        style={[
                            styles.planCard,
                            selectedPlan === 'yearly' && styles.planCardSelected,
                        ]}
                    >
                        <View style={styles.bestValueBadge}>
                            <Text style={styles.bestValueText}>BEST VALUE</Text>
                        </View>
                        <View style={styles.planHeader}>
                            <View>
                                <Text style={styles.planName}>Yearly</Text>
                                <Text style={styles.planPrice}>
                                    {yearlyPrice}
                                    <Text style={styles.planPeriod}> / year</Text>
                                </Text>
                            </View>
                            <View style={styles.radioOuter}>
                                {selectedPlan === 'yearly' && <View style={styles.radioInner} />}
                            </View>
                        </View>
                        <View style={styles.savingsRow}>
                            <MaterialIcons name="local-offer" size={14} color="#166534" />
                            <Text style={styles.savingsText}>Save 16% — just $4.17/mo</Text>
                        </View>
                    </TouchableOpacity>

                    {/* Monthly */}
                    <TouchableOpacity
                        activeOpacity={0.85}
                        onPress={() => setSelectedPlan('monthly')}
                        style={[
                            styles.planCard,
                            selectedPlan === 'monthly' && styles.planCardSelected,
                        ]}
                    >
                        <View style={styles.planHeader}>
                            <View>
                                <Text style={styles.planName}>Monthly</Text>
                                <Text style={styles.planPrice}>
                                    {monthlyPrice}
                                    <Text style={styles.planPeriod}> / month</Text>
                                </Text>
                            </View>
                            <View style={styles.radioOuter}>
                                {selectedPlan === 'monthly' && <View style={styles.radioInner} />}
                            </View>
                        </View>
                    </TouchableOpacity>
                </View>

                {/* ═══ Feature List ═══ */}
                <View style={styles.featuresSection}>
                    <Text style={styles.featuresTitle}>Everything included</Text>
                    {features.map((feature, idx) => (
                        <View key={idx} style={styles.featureRow}>
                            <View style={styles.featureIconBg}>
                                <MaterialIcons name={feature.icon} size={18} color="#1a1a00" />
                            </View>
                            <Text style={styles.featureText}>{feature.text}</Text>
                        </View>
                    ))}
                </View>

                {/* ═══ CTA Section ═══ */}
                <View style={styles.ctaSection}>
                    <TouchableOpacity
                        activeOpacity={0.9}
                        onPress={handlePurchase}
                        disabled={purchasing}
                        style={styles.ctaButton}
                    >
                        <LinearGradient
                            colors={
                                mode === 'welcome'
                                    ? ['#4ade80', '#22c55e']
                                    : ['#FFFC00', '#E6E300']
                            }
                            style={styles.ctaGradient}
                        >
                            {purchasing ? (
                                <ActivityIndicator color="#041015" />
                            ) : (
                                <Text style={styles.ctaText}>
                                    {config.ctaLabel(selectedPrice)}
                                </Text>
                            )}
                        </LinearGradient>
                    </TouchableOpacity>

                    <Text style={styles.trialNote}>
                        {mode === 'welcome'
                            ? '30 days free • No charge until trial ends • Cancel anytime'
                            : '1 month free trial included • Cancel anytime'}
                    </Text>

                    {/* Maybe Later / Not Yet — only for welcome & upgrade */}
                    {config.showDismiss && (
                        <TouchableOpacity
                            onPress={() => router.back()}
                            style={styles.dismissBtn}
                            activeOpacity={0.7}
                        >
                            <Text style={styles.dismissText}>{config.dismissLabel}</Text>
                        </TouchableOpacity>
                    )}

                    <TouchableOpacity onPress={restorePurchases} style={styles.restoreBtn}>
                        <Text style={styles.restoreText}>Restore Purchase</Text>
                    </TouchableOpacity>
                </View>

                {/* Legal */}
                <Text style={styles.legalText}>
                    Payment will be charged to your App Store account at confirmation of purchase.
                    Subscription automatically renews unless auto-renew is turned off at least 24
                    hours before the end of the current period.
                </Text>

                <View style={{ height: insets.bottom + 20 }} />
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#FFFFFF',
    },
    closeButton: {
        position: 'absolute',
        top: 12,
        right: 16,
        zIndex: 10,
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: 'rgba(255,255,255,0.9)',
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    scrollContent: {
        paddingBottom: 40,
    },

    // ─── Hero ───
    heroSection: {
        width: '100%',
        overflow: 'hidden',
    },
    heroGradient: {
        width: '100%',
        alignItems: 'center',
        paddingTop: 48,
        paddingBottom: 36,
        position: 'relative',
    },
    glowCircle: {
        position: 'absolute',
        top: 20,
        width: 220,
        height: 220,
        borderRadius: 110,
    },
    petImageWrapper: {
        width: 120,
        height: 120,
        borderRadius: 60,
        borderWidth: 3,
        overflow: 'hidden',
        marginBottom: 16,
        shadowColor: '#FFFC00',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.3,
        shadowRadius: 20,
        elevation: 10,
    },
    petImage: {
        width: '100%',
        height: '100%',
    },
    emoji: {
        fontSize: 32,
        marginBottom: 12,
    },
    heroTitle: {
        fontFamily: 'Plus Jakarta Sans',
        fontSize: 26,
        fontWeight: '800',
        color: '#FFFFFF',
        textAlign: 'center',
        marginBottom: 10,
        lineHeight: 34,
    },
    heroSubtitle: {
        fontFamily: 'Plus Jakarta Sans',
        fontSize: 14,
        fontWeight: '500',
        color: 'rgba(255,255,255,0.65)',
        textAlign: 'center',
        lineHeight: 22,
        paddingHorizontal: 36,
    },

    // Trust signals (welcome mode)
    trustRow: {
        flexDirection: 'row',
        gap: 8,
        marginTop: 20,
        flexWrap: 'wrap',
        justifyContent: 'center',
        paddingHorizontal: 20,
    },
    trustPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: 'rgba(74, 222, 128, 0.12)',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: 'rgba(74, 222, 128, 0.2)',
    },
    trustText: {
        fontFamily: 'Plus Jakarta Sans',
        fontSize: 11,
        fontWeight: '600',
        color: '#4ade80',
    },

    // Countdown pill (upgrade mode)
    countdownPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: 20,
        backgroundColor: 'rgba(251, 191, 36, 0.12)',
        paddingHorizontal: 14,
        paddingVertical: 6,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: 'rgba(251, 191, 36, 0.2)',
    },
    countdownText: {
        fontFamily: 'Plus Jakarta Sans',
        fontSize: 12,
        fontWeight: '700',
        color: '#fbbf24',
    },

    // ─── Plans ───
    plansSection: {
        paddingHorizontal: 20,
        paddingTop: 28,
    },
    plansTitle: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '700',
        fontSize: 18,
        color: '#041015',
        marginBottom: 16,
    },
    planCard: {
        borderWidth: 2,
        borderColor: '#e0e0e0',
        borderRadius: 16,
        padding: 18,
        marginBottom: 12,
        backgroundColor: '#FFFFFF',
        position: 'relative',
        overflow: 'hidden',
    },
    planCardSelected: {
        borderColor: '#FFFC00',
        backgroundColor: '#fffef5',
    },
    bestValueBadge: {
        position: 'absolute',
        top: 0,
        right: 0,
        backgroundColor: '#041015',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderBottomLeftRadius: 10,
    },
    bestValueText: {
        fontFamily: 'Plus Jakarta Sans',
        fontSize: 10,
        fontWeight: '800',
        color: '#FFFFFF',
        letterSpacing: 0.5,
    },
    planHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    planName: {
        fontFamily: 'Plus Jakarta Sans',
        fontSize: 16,
        fontWeight: '700',
        color: '#041015',
        marginBottom: 2,
    },
    planPrice: {
        fontFamily: 'Plus Jakarta Sans',
        fontSize: 20,
        fontWeight: '800',
        color: '#041015',
    },
    planPeriod: {
        fontSize: 13,
        fontWeight: '500',
        color: '#041015',
    },
    radioOuter: {
        width: 24,
        height: 24,
        borderRadius: 12,
        borderWidth: 2,
        borderColor: '#FFFC00',
        justifyContent: 'center',
        alignItems: 'center',
    },
    radioInner: {
        width: 14,
        height: 14,
        borderRadius: 7,
        backgroundColor: '#FFFC00',
    },
    savingsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 10,
        gap: 6,
        backgroundColor: '#FFFC00',
        alignSelf: 'flex-start',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 20,
    },
    savingsText: {
        fontFamily: 'Plus Jakarta Sans',
        fontSize: 12,
        fontWeight: '700',
        color: '#041015',
    },

    // ─── Features ───
    featuresSection: {
        paddingHorizontal: 20,
        paddingTop: 24,
    },
    featuresTitle: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '700',
        fontSize: 16,
        color: '#041015',
        marginBottom: 14,
    },
    featureRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
        gap: 12,
    },
    featureIconBg: {
        width: 32,
        height: 32,
        borderRadius: 8,
        backgroundColor: '#FFFC00',
        justifyContent: 'center',
        alignItems: 'center',
    },
    featureText: {
        fontFamily: 'Plus Jakarta Sans',
        fontSize: 14,
        fontWeight: '600',
        color: '#041015',
    },

    // ─── CTA ───
    ctaSection: {
        paddingHorizontal: 20,
        paddingTop: 28,
        alignItems: 'center',
    },
    ctaButton: {
        width: '100%',
        borderRadius: 16,
        overflow: 'hidden',
        shadowColor: '#FFFC00',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
        elevation: 6,
    },
    ctaGradient: {
        paddingVertical: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    ctaText: {
        fontFamily: 'Plus Jakarta Sans',
        fontSize: 15,
        fontWeight: '800',
        color: '#041015',
        letterSpacing: 0.3,
    },
    trialNote: {
        fontFamily: 'Plus Jakarta Sans',
        fontSize: 11,
        fontWeight: '600',
        color: '#64748b',
        marginTop: 12,
        textAlign: 'center',
    },
    dismissBtn: {
        marginTop: 16,
        paddingVertical: 12,
        paddingHorizontal: 32,
    },
    dismissText: {
        fontFamily: 'Plus Jakarta Sans',
        fontSize: 15,
        fontWeight: '600',
        color: '#94a3b8',
    },
    restoreBtn: {
        marginTop: 8,
        paddingVertical: 8,
    },
    restoreText: {
        fontFamily: 'Plus Jakarta Sans',
        fontSize: 13,
        fontWeight: '600',
        color: '#041015',
        textDecorationLine: 'underline',
    },

    // Legal
    legalText: {
        fontFamily: 'Plus Jakarta Sans',
        fontSize: 10,
        color: 'rgba(4, 16, 21, 0.5)',
        textAlign: 'center',
        lineHeight: 16,
        paddingHorizontal: 30,
        marginTop: 20,
    },
});
