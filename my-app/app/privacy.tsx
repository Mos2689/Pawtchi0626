import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Header } from '../components/Header';
import { color, font, radius, space } from '../constants/design';

export default function PrivacyScreen() {
    const insets = useSafeAreaInsets();

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            <Header title="Privacy & Security" />

            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                <View style={styles.legalBox}>
                    <Text style={styles.companyName}>Hey Living Club Pty Ltd</Text>
                    <Text style={styles.companyAddress}>128 Tallawong Road{'\n'}Rouse Hill, NSW, 2152</Text>
                    <Text style={[styles.companyAddress, { marginTop: space.md, color: color.yellow }]}>Last Updated: April 2026</Text>
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
                    All purchases are processed securely via your Apple ID or Google Play account. Financial data is handled directly by Apple Inc. or Google LLC and is never accessible by Hey Living Club Pty Ltd. You may manage or cancel subscriptions through your device's subscription settings (iOS: Settings → Apple ID → Subscriptions; Android: Google Play Store → Payments & subscriptions → Subscriptions).
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
        backgroundColor: color.surfaceSubtle,
    },
    scrollContent: {
        padding: space.xxl,
        paddingBottom: 40,
    },
    legalBox: {
        backgroundColor: color.navy,
        borderRadius: radius.xl,
        padding: space.xxl,
        marginBottom: space.xxxl,
    },
    companyName: {
        fontFamily: font.extrabold,
        fontSize: 20,
        color: color.cream,
        marginBottom: space.sm,
    },
    companyAddress: {
        fontFamily: font.semibold,
        fontSize: 14,
        color: color.slateFaint,
        lineHeight: 22,
    },
    sectionTitle: {
        fontFamily: font.extrabold,
        fontSize: 16,
        color: color.ink,
        marginBottom: space.md,
        marginTop: space.sm,
    },
    paragraph: {
        fontFamily: font.medium,
        fontSize: 14,
        color: color.slate,
        lineHeight: 24,
        marginBottom: space.xxl,
    },
});
