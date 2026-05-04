import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSubscription } from '../hooks/useSubscription';

export function TrialBanner() {
    const { status, daysLeft } = useSubscription();
    const router = useRouter();

    // Only show when trial is active and ≤ 5 days left
    if (status !== 'trial' || daysLeft === null || daysLeft > 5) {
        return null;
    }

    const urgency = daysLeft <= 2;

    return (
        <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => router.push('/paywall' as any)}
            style={[
                styles.container,
                { backgroundColor: urgency ? '#fef2f2' : '#fefce8' },
            ]}
        >
            <View style={styles.left}>
                <MaterialIcons
                    name={urgency ? 'warning' : 'schedule'}
                    size={18}
                    color={urgency ? '#dc2626' : '#a16207'}
                />
                <Text
                    style={[
                        styles.text,
                        { color: urgency ? '#dc2626' : '#a16207' },
                    ]}
                >
                    {daysLeft === 0
                        ? 'Your free trial ends today!'
                        : daysLeft === 1
                            ? 'Only 1 day left in your free trial'
                            : `${daysLeft} days left in your free trial`}
                </Text>
            </View>
            <View style={styles.ctaPill}>
                <Text style={styles.ctaText}>View Plans</Text>
                <MaterialIcons name="chevron-right" size={14} color="#1a1a00" />
            </View>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 10,
        marginHorizontal: 16,
        marginTop: 8,
        borderRadius: 12,
    },
    left: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        flex: 1,
    },
    text: {
        fontFamily: 'Plus Jakarta Sans',
        fontSize: 12,
        fontWeight: '700',
        flex: 1,
    },
    ctaPill: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFC00',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 20,
        marginLeft: 8,
    },
    ctaText: {
        fontFamily: 'Plus Jakarta Sans',
        fontSize: 11,
        fontWeight: '800',
        color: '#1a1a00',
    },
});
