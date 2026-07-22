import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSubscription } from '../hooks/useSubscription';
import { useActivePetStore } from '../store/useActivePetStore';
import { color, font, radius, space } from '../constants/design';

// Calm trial reminder — navy brand card, no urgency theatrics (brand: calm
// beats urgent, never an exclamation). Yellow marks the one action.
export function TrialBanner() {
    const { status, daysLeft } = useSubscription();
    const activePet = useActivePetStore(s => s.activePet);
    const router = useRouter();

    // Only show when trial is active and ≤ 5 days left
    if (status !== 'trial' || daysLeft === null || daysLeft > 5) {
        return null;
    }

    const petName = activePet?.name?.trim();
    const tail = petName ? ` — keep ${petName}’s picture complete` : '';
    const message =
        daysLeft === 0
            ? `Your trial ends today${tail}`
            : daysLeft === 1
                ? `1 day left on your trial${tail}`
                : `${daysLeft} days left on your trial${tail}`;

    return (
        <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => router.push('/paywall' as any)}
            style={styles.container}
        >
            <View style={styles.left}>
                <MaterialIcons name="schedule" size={18} color={color.creamDim} />
                <Text style={styles.text} numberOfLines={2}>
                    {message}
                </Text>
            </View>
            <View style={styles.ctaPill}>
                <Text style={styles.ctaText}>See plans</Text>
                <MaterialIcons name="chevron-right" size={14} color={color.navy} />
            </View>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        marginHorizontal: space.lg,
        marginTop: space.sm,
        borderRadius: radius.lg,
        backgroundColor: color.navy,
    },
    left: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        flex: 1,
    },
    text: {
        fontFamily: font.semibold,
        fontSize: 12.5,
        color: color.cream,
        flex: 1,
        lineHeight: 17,
    },
    ctaPill: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: color.yellow,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: radius.pill,
        marginLeft: space.sm,
    },
    ctaText: {
        fontFamily: font.bold,
        fontSize: 11,
        color: color.navy,
    },
});
