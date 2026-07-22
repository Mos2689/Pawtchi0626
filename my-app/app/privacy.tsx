import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Header } from '../components/Header';
import { color, font, radius, space } from '../constants/design';

export default function PrivacyScreen() {
    const insets = useSafeAreaInsets();

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            <Header title="Privacy Policy" />

            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                <View style={styles.legalBox}>
                    <Text style={styles.companyName}>Hey Living Club Pty Ltd</Text>
                    <Text style={styles.companyAddress}>128 Tallawong Road{'\n'}Rouse Hill, NSW 2152, Australia</Text>
                    <Text style={styles.companyAddress}>Contact: privacy@heylivingclub.com</Text>
                    <Text style={[styles.companyAddress, { marginTop: space.md, color: color.yellow }]}>Last updated: July 2026</Text>
                </View>

                <Text style={styles.paragraph}>
                    This Privacy Policy explains how Hey Living Club Pty Ltd (ABN registered in Australia), trading as “Pawtchi” (“we”, “us”, “our”), collects, uses, stores, discloses and protects personal information when you use the Pawtchi mobile application and related services (the “App”).
                    {'\n\n'}We handle personal information in accordance with the Australian Privacy Act 1988 (Cth) and the 13 Australian Privacy Principles (APPs), the New Zealand Privacy Act 2020 and the 13 Information Privacy Principles (IPPs), and the developer privacy requirements of the Apple App Store and Google Play. This policy is written to be read together with the Pawtchi Terms of Service.
                </Text>

                <Text style={styles.sectionTitle}>1. Who we are and how to contact us</Text>
                <Text style={styles.paragraph}>
                    Hey Living Club Pty Ltd is the data controller for personal information collected through the App. For any privacy question, access request, correction request or complaint, please email privacy@heylivingclub.com or write to us at the postal address above. We aim to respond to privacy requests within 30 days.
                </Text>

                <Text style={styles.sectionTitle}>2. Information we collect</Text>
                <Text style={styles.paragraph}>
                    We only collect information that is reasonably necessary to run the features you use. We do not collect sensitive information about you (as defined in the Privacy Act) beyond what is described below.
                    {'\n\n'}<Text style={{ fontWeight: 'bold' }}>Account information.</Text> When you create an account we collect your email address and a password (stored in hashed form by our authentication provider). We do not collect your legal name, date of birth or government identifiers.
                    {'\n\n'}<Text style={{ fontWeight: 'bold' }}>Pet profile information you provide.</Text> Your pet’s name, species, breed, sex, date of birth or age, current weight, body condition score, activity level, life stage, allergies or intolerances you record, medical conditions you record, and an optional pet profile photo. This information is used to calculate feeding, hydration and activity targets and to personalise guidance.
                    {'\n\n'}<Text style={{ fontWeight: 'bold' }}>Photos you submit.</Text> Photos of pet food, meals, treats, packaging labels and veterinary reports that you capture with the camera or select from your photo library so that the App can analyse them and return a verdict or extract structured information. If you add a photo of your pet, the App may also analyse it to estimate your pet’s body condition and suggest a starting point, which you can always change.
                    {'\n\n'}<Text style={{ fontWeight: 'bold' }}>Activity and health logs.</Text> Meals logged, water logged, walks and other activities logged, weight entries, milestones, streaks, ideal-weight estimates, AI-generated verdicts and vet-style answers, and vet-check-in responses.
                    {'\n\n'}<Text style={{ fontWeight: 'bold' }}>Walk location data.</Text> When you start a tracked walk, we collect your device’s approximate and precise location while the walk is in progress in order to measure the route, distance, pace, duration and to reverse-geocode start and end points into a location label. On Android this uses a foreground service so the walk can continue if the screen locks. We do not collect location when a walk is not in progress and we do not use background location for advertising.
                    {'\n\n'}<Text style={{ fontWeight: 'bold' }}>Purchase information.</Text> If you subscribe, the payment itself is completed by Apple or Google and we never see your card details. We receive a subscription entitlement status, plan identifier, purchase and renewal dates and an anonymous subscriber identifier from RevenueCat so we can unlock premium features and restore purchases.
                    {'\n\n'}<Text style={{ fontWeight: 'bold' }}>Device and diagnostic information.</Text> Device model, operating system version, app version, language, time zone, an anonymous installation identifier, crash reports and non-precise IP-derived country. This is used for stability, security, fraud prevention and analytics.
                    {'\n\n'}<Text style={{ fontWeight: 'bold' }}>Product analytics.</Text> Event names and non-identifying parameters recording which screens you view and which actions you take (for example, that onboarding was completed, that the paywall was viewed, that a walk was started). Sensitive fields such as your email, pet name, breed and allergies are actively stripped by an allowlist before events are sent to third-party analytics or advertising SDKs.
                    {'\n\n'}<Text style={{ fontWeight: 'bold' }}>Push notification token.</Text> If you grant notification permission we store an anonymous push token so we can deliver reminders and check-ins. You can revoke this at any time in your device settings.
                    {'\n\n'}<Text style={{ fontWeight: 'bold' }}>Advertising identifier (iOS only, with consent).</Text> On iOS we present Apple’s App Tracking Transparency prompt. Tracking across other apps and websites happens only if you tap “Allow”. If you decline, the identifier is not used.
                </Text>

                <Text style={styles.sectionTitle}>3. How we collect information (APP 3, IPP 2–4)</Text>
                <Text style={styles.paragraph}>
                    We collect information directly from you when you create an account, complete onboarding, log meals, log walks, submit photos, ask a question or subscribe. Diagnostic and analytics data is collected automatically from your device when you use the App. We do not knowingly collect personal information from third-party data brokers.
                </Text>

                <Text style={styles.sectionTitle}>4. Why we use your information (APP 6, IPP 10)</Text>
                <Text style={styles.paragraph}>
                    We use information for the primary purpose for which it was collected and for directly related secondary purposes you would reasonably expect, including:
                    {'\n'}• operating the food scanner, verdict engine, portion and hydration math, activity tracking and vet-style Q&A;
                    {'\n'}• generating personalised feeding, hydration and activity plans and vet-ready PDF reports;
                    {'\n'}• delivering reminders, check-ins and streak notifications you have opted in to;
                    {'\n'}• processing subscriptions, restoring purchases and preventing subscription fraud;
                    {'\n'}• measuring product performance, crashes and funnel drop-off so we can improve the App;
                    {'\n'}• complying with our legal obligations, including under the Privacy Act 1988 (Cth) and the Privacy Act 2020 (NZ).
                </Text>

                <Text style={styles.sectionTitle}>5. Third parties we share information with (APP 6, IPP 11)</Text>
                <Text style={styles.paragraph}>
                    We do not sell your personal information. We share the minimum information necessary with the following processors, each of which is contractually bound to protect it:
                    {'\n\n'}• <Text style={{ fontWeight: 'bold' }}>Supabase</Text> — hosted database, authentication and file storage for pet profiles, logs, photos and reports.
                    {'\n'}• <Text style={{ fontWeight: 'bold' }}>Google (Gemini API)</Text> — server-to-server processing of photos and text so the App can return food verdicts, parse veterinary reports and answer vet-style questions. Content sent via the API is not used to train Google’s foundation models.
                    {'\n'}• <Text style={{ fontWeight: 'bold' }}>RevenueCat</Text> — subscription entitlement, receipt validation and restore-purchase support.
                    {'\n'}• <Text style={{ fontWeight: 'bold' }}>Apple and Google (Play Billing)</Text> — payment processing for in-app subscriptions.
                    {'\n'}• <Text style={{ fontWeight: 'bold' }}>Expo (push notifications)</Text> — delivery of push tokens and notifications to your device.
                    {'\n'}• <Text style={{ fontWeight: 'bold' }}>PostHog</Text> — de-identified product analytics and crash-related diagnostics.
                    {'\n'}• <Text style={{ fontWeight: 'bold' }}>Meta (Facebook App Events)</Text> — attribution and marketing measurement using de-identified event names and a small allowlist of non-sensitive properties, only after you consent through App Tracking Transparency on iOS. A property allowlist and PII blocklist strip email, user id, pet name, breed and allergies before any event reaches Meta.
                    {'\n'}• <Text style={{ fontWeight: 'bold' }}>Resend (transactional email)</Text> — delivery of transactional emails such as account confirmations sent from privacy@heylivingclub.com.
                    {'\n\n'}We may also disclose information if required by law, to enforce our Terms of Service, or to protect the rights, property or safety of Pawtchi, our users or the public.
                </Text>

                <Text style={styles.sectionTitle}>6. Cross-border disclosure (APP 8, IPP 12)</Text>
                <Text style={styles.paragraph}>
                    Some of the providers listed above store or process personal information outside Australia and New Zealand, including in the United States and the European Union. Before disclosing personal information overseas we take reasonable steps to ensure the recipient handles that information in a manner consistent with the APPs and the IPPs, including through written data-processing agreements. By using the App you consent to this overseas disclosure for the purposes described.
                </Text>

                <Text style={styles.sectionTitle}>7. Direct marketing (APP 7)</Text>
                <Text style={styles.paragraph}>
                    We do not send unsolicited marketing emails. Push notifications are only used for feature reminders and check-ins you have opted in to, and can be turned off at any time in your device settings. We do not use your health-related pet information for advertising targeting.
                </Text>

                <Text style={styles.sectionTitle}>8. Device permissions</Text>
                <Text style={styles.paragraph}>
                    The App requests the following permissions, which are optional and can be revoked at any time in your device settings:
                    {'\n'}• <Text style={{ fontWeight: 'bold' }}>Camera</Text> — to scan pet food and veterinary documents.
                    {'\n'}• <Text style={{ fontWeight: 'bold' }}>Photo library</Text> — to select a pet profile photo or an existing food photo.
                    {'\n'}• <Text style={{ fontWeight: 'bold' }}>Location (when in use / foreground)</Text> — to record tracked walks. On Android the walk uses a foreground service while active. We do not request background location.
                    {'\n'}• <Text style={{ fontWeight: 'bold' }}>Notifications</Text> — to deliver reminders, activity nudges and vet check-ins.
                    {'\n'}• <Text style={{ fontWeight: 'bold' }}>App Tracking Transparency (iOS)</Text> — required by Apple before any cross-app tracking identifier is used.
                </Text>

                <Text style={styles.sectionTitle}>9. Data quality (APP 10, IPP 8)</Text>
                <Text style={styles.paragraph}>
                    We take reasonable steps to ensure the personal information we hold is accurate, up-to-date, complete and relevant. You can review and update your account and pet information at any time from the Profile tab.
                </Text>

                <Text style={styles.sectionTitle}>10. Security (APP 11, IPP 5)</Text>
                <Text style={styles.paragraph}>
                    We use technical and organisational measures to protect your information, including encryption in transit (TLS), encryption at rest on our infrastructure providers, hashed passwords, row-level security on our database, restricted staff access on a need-to-know basis and audit logging. No system is perfectly secure; if we become aware of an eligible data breach that is likely to result in serious harm, we will notify affected users and the Office of the Australian Information Commissioner (OAIC) as required under the Notifiable Data Breaches scheme, and the Office of the Privacy Commissioner (NZ) as required under the Privacy Act 2020.
                </Text>

                <Text style={styles.sectionTitle}>11. Retention and deletion</Text>
                <Text style={styles.paragraph}>
                    We retain personal information only for as long as needed to provide the App or as required by law. When you delete your account from the Profile screen, we permanently delete your account, pet profiles, logs, photos, walk routes, veterinary documents and reports from our operational data stores. De-identified analytics events and financial records we are required to keep for tax and audit purposes may be retained for the period required by law.
                </Text>

                <Text style={styles.sectionTitle}>12. Your rights — access, correction and complaints (APP 12/13, IPP 6/7)</Text>
                <Text style={styles.paragraph}>
                    You have the right to request access to the personal information we hold about you and to request that it be corrected. Most information is directly viewable and editable inside the App. For anything else, email privacy@heylivingclub.com and we will respond within 30 days.
                    {'\n\n'}If you believe we have breached the Australian Privacy Principles or the New Zealand Information Privacy Principles, please contact us first so we can try to resolve it. If you are not satisfied you may lodge a complaint with:
                    {'\n'}• Office of the Australian Information Commissioner (OAIC) — oaic.gov.au or 1300 363 992.
                    {'\n'}• Office of the Privacy Commissioner (New Zealand) — privacy.org.nz or 0800 803 909.
                </Text>

                <Text style={styles.sectionTitle}>13. Subscriptions and billing</Text>
                <Text style={styles.paragraph}>
                    All subscription purchases are processed by Apple or Google. Financial data (card number, billing address) is handled directly by them and is never received by Hey Living Club Pty Ltd. You can manage or cancel subscriptions from your device: on iOS via Settings → Apple ID → Subscriptions; on Android via Google Play Store → Payments &amp; subscriptions → Subscriptions.
                </Text>

                <Text style={styles.sectionTitle}>14. Children</Text>
                <Text style={styles.paragraph}>
                    Pawtchi is not directed to children under 13, and we do not knowingly collect personal information from children. If you believe a child has provided us with personal information, please contact privacy@heylivingclub.com and we will delete it.
                </Text>

                <Text style={styles.sectionTitle}>15. Apple App Store and Google Play disclosures</Text>
                <Text style={styles.paragraph}>
                    We publish an Apple Privacy Nutrition Label and a Google Play Data Safety declaration alongside this policy. Those disclosures reflect the same data categories described here: contact info (email), user content (photos of food and veterinary reports, pet profile photo), health &amp; fitness (pet weight, body condition, activity), identifiers (anonymous installation and subscriber identifiers), purchases, location (only while a walk is active), diagnostics and product interaction. We do not use your data for third-party advertising, we do not use it for tracking as defined by Apple unless you grant App Tracking Transparency consent, and we do not sell data.
                </Text>

                <Text style={styles.sectionTitle}>16. Changes to this policy</Text>
                <Text style={styles.paragraph}>
                    We may update this policy from time to time. If we make a material change we will notify you inside the App and update the “Last updated” date above. Continued use of the App after a change means you accept the updated policy.
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
        marginTop: space.xs,
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
