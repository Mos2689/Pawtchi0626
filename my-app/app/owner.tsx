import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '../providers/AuthProvider';
import { PawtchiButton } from '../components/PawtchiButton';
import { Header } from '../components/Header';
import { color, font, radius, shadow, space } from '../constants/design';

export default function OwnerProfileScreen() {
    const insets = useSafeAreaInsets();
    const { user } = useAuth();

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            <Header title="Owner Profile" />

            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                <View style={styles.infoCard}>
                    <View style={styles.avatar}>
                        <MaterialIcons name="person" size={48} color={color.ink} />
                    </View>
                    <Text style={styles.emailName}>{user?.email || 'Owner Account'}</Text>

                    <View style={styles.detailsBox}>
                        <View style={styles.detailRow}>
                            <Text style={styles.detailLabel}>Email Address</Text>
                            <Text style={styles.detailValue}>{user?.email || 'Loading...'}</Text>
                        </View>
                        <View style={styles.divider} />
                        <View style={styles.detailRow}>
                            <Text style={styles.detailLabel}>Account ID</Text>
                            <Text style={styles.detailValue}>{user?.id?.substring(0, 8) || '...'}**</Text>
                        </View>
                    </View>

                    <PawtchiButton
                        title="Manage Account Details"
                        variant="primary"
                        onPress={() => {}}
                        style={{ width: '100%' }}
                    />
                </View>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: color.surfaceSubtle,
    },
    scrollContent: {
        padding: space.xxl,
    },
    infoCard: {
        backgroundColor: color.surface,
        borderRadius: radius.xl,
        padding: space.xxl,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: color.hairline,
        ...shadow.card,
    },
    avatar: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: color.track,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: space.lg,
    },
    emailName: {
        fontFamily: font.extrabold,
        fontSize: 18,
        color: color.ink,
        marginBottom: space.xxxl,
    },
    detailsBox: {
        width: '100%',
        backgroundColor: color.surfaceSubtle,
        borderRadius: radius.lg,
        padding: space.lg,
        marginBottom: space.xxl,
        borderWidth: 1,
        borderColor: color.hairline,
    },
    detailRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: space.sm,
    },
    divider: {
        height: 1,
        backgroundColor: color.hairline,
        marginVertical: space.xs,
    },
    detailLabel: {
        fontFamily: font.semibold,
        fontSize: 14,
        color: color.slateMuted,
    },
    detailValue: {
        fontFamily: font.bold,
        fontSize: 14,
        color: color.ink,
    },
});
