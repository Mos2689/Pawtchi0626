import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '../providers/AuthProvider';
import { PawtchiButton } from '../components/PawtchiButton';

export default function OwnerProfileScreen() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} style={styles.backBtn}>
                    <MaterialIcons name="arrow-back-ios" size={20} color="#0f172a" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Owner Profile</Text>
                <View style={{ width: 40 }} />
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                <View style={styles.infoCard}>
                    <View style={styles.avatar}>
                        <MaterialIcons name="person" size={48} color="#041015" />
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
        backgroundColor: '#f8fafc',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 24,
        paddingBottom: 16,
        backgroundColor: '#f8fafc',
    },
    backBtn: {
        width: 40,
        height: 40,
        justifyContent: 'center',
    },
    headerTitle: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '700',
        fontSize: 18,
        color: '#0f172a',
    },
    scrollContent: {
        padding: 24,
    },
    infoCard: {
        backgroundColor: '#ffffff',
        borderRadius: 24,
        padding: 24,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.05,
        shadowRadius: 12,
        elevation: 2,
    },
    avatar: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: '#f1f5f9',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 16,
    },
    emailName: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '800',
        fontSize: 18,
        color: '#0f172a',
        marginBottom: 32,
    },
    detailsBox: {
        width: '100%',
        backgroundColor: '#f8fafc',
        borderRadius: 16,
        padding: 16,
        marginBottom: 24,
        borderWidth: 1,
        borderColor: '#f1f5f9',
    },
    detailRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 8,
    },
    divider: {
        height: 1,
        backgroundColor: '#e2e8f0',
        marginVertical: 4,
    },
    detailLabel: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '600',
        fontSize: 14,
        color: '#64748b',
    },
    detailValue: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '700',
        fontSize: 14,
        color: '#0f172a',
    },
    manageBtn: {
        backgroundColor: '#FFFC00',
        width: '100%',
        paddingVertical: 16,
        borderRadius: 100,
        alignItems: 'center',
    },
    manageBtnText: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '800',
        fontSize: 14,
        color: '#041015',
    },
});
