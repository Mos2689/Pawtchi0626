import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

export default function PrivacyScreen() {
    const insets = useSafeAreaInsets();
    const router = useRouter();

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} style={styles.backBtn}>
                    <MaterialIcons name="arrow-back-ios" size={20} color="#0f172a" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Privacy & Security</Text>
                <View style={{ width: 40 }} />
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                <View style={styles.legalBox}>
                    <Text style={styles.companyName}>Hey Living Club Pty Ltd</Text>
                    <Text style={styles.companyAddress}>128 Tallawong Road{'\n'}Rouse Hill, NSW, 2152</Text>
                    <Text style={[styles.companyAddress, { marginTop: 12, color: '#FFFC00' }]}>Last Updated: April 2026</Text>
                </View>

                <Text style={styles.sectionTitle}>1. Data Collection & Usage</Text>
                <Text style={styles.paragraph}>
                    In compliance with App Store guidelines, we transparently disclose that we collect the following data types to provide core functionality:
                    {'\n'}• <Text style={{ fontWeight: 'bold' }}>Contact Info:</Text> Email addresses used strictly for account authentication.
                    {'\n'}• <Text style={{ fontWeight: 'bold' }}>User Content:</Text> Photos uploaded to the app via the meal scanner or medical document uploads.
                    {'\n'}• <Text style={{ fontWeight: 'bold' }}>Health & Fitness Data:</Text> Pet physiological data (weight, age, breed) provided by you to calculate baseline statistics.
                </Text>

                <Text style={styles.sectionTitle}>2. Third-Party Service Providers</Text>
                <Text style={styles.paragraph}>
                    We share necessary data subsets with vetted third parties strictly to facilitate app features. We do not sell your data to advertisers.
                    {'\n'}• <Text style={{ fontWeight: 'bold' }}>Supabase:</Text> Cloud database and secure identity management.
                    {'\n'}• <Text style={{ fontWeight: 'bold' }}>RevenueCat:</Text> Processes in-app purchases and subscription statuses.
                    {'\n'}• <Text style={{ fontWeight: 'bold' }}>Google Gemini AI:</Text> Processes image artifacts (food bowls, medical reports) exclusively for generative insight generation. Images passed to the API are not utilized for public foundation model training.
                </Text>

                <Text style={styles.sectionTitle}>3. Subscriptions & Billing</Text>
                <Text style={styles.paragraph}>
                    All purchases are processed securely via your Apple ID. Financial data is handled directly by Apple Inc. and is never accessible by Hey Living Club Pty Ltd. You may manage or cancel subscriptions natively through your iOS Device Settings.
                </Text>

                <Text style={styles.sectionTitle}>4. Data Deprovisioning & User Rights</Text>
                <Text style={styles.paragraph}>
                    You retain full sovereignty over your data. Upon requesting account deletion via the &quot;Account Info&quot; panel, all associated profiles, raw image scans, clinical files, and routine schedules will be permanently purged from our operational data stores in accordance with global data residency regulations.
                </Text>

                <Text style={styles.sectionTitle}>5. Contact Us</Text>
                <Text style={styles.paragraph}>
                    For privacy inquiries or data subject access requests, please send correspondence to the registered business address above.
                </Text>

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
        paddingBottom: 40,
    },
    legalBox: {
        backgroundColor: '#1e293b',
        borderRadius: 20,
        padding: 24,
        marginBottom: 32,
    },
    companyName: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '900',
        fontSize: 20,
        color: '#f8fafc',
        marginBottom: 8,
    },
    companyAddress: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '600',
        fontSize: 14,
        color: '#94a3b8',
        lineHeight: 22,
    },
    sectionTitle: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '800',
        fontSize: 16,
        color: '#0f172a',
        marginBottom: 12,
        marginTop: 8,
    },
    paragraph: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '500',
        fontSize: 14,
        color: '#475569',
        lineHeight: 24,
        marginBottom: 24,
    },
});
