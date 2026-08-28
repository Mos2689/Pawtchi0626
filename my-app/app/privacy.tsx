/**
 * Privacy Policy — the shipped, user-facing policy.
 *
 * ── Keep in sync ──
 * This screen and `Privacy Policy.docx` (the published/store-linked copy) must
 * say the same thing. They drifted once before: the app carried a BCS-photo
 * sentence the document did not. Change both, or neither.
 *
 * Every statement here was checked against the code. Do not add a favourable
 * claim ("anonymous", "de-identified", "stripped before sending") unless the
 * code actually does it — a policy that overstates protection is worse than
 * one that admits the truth.
 *
 * ── Still to resolve (see docs/privacy-policy-revised.md) ──
 *  • §5  Gemini: the "not used to train Google's models" claim holds on the
 *        PAID API tier only. Confirm billing tier, then add or leave out.
 *  • §6  Supabase project region is not stated — add it once confirmed.
 *  • §12 No retention period for walk location data. §12 now states this plainly
 *        (kept for the life of the account) rather than staying silent, but
 *        indefinite retention of a route history that reveals a home address is
 *        hard to justify under APP 11.2 / IPP 9. Do NOT write a fixed period
 *        here until the purge job exists — an earlier draft of the .md claimed
 *        "12 months" with nothing implementing it.
 *  • §2/§18 The Android advertising-identifier wording is written to current
 *        reality (no consent gate). If the gate is added, restore the stronger
 *        "only with consent" wording on both platforms.
 */
import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Header } from '../components/Header';
import { color, font, radius, space } from '../constants/design';

const B = { fontWeight: 'bold' } as const;

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
                    <Text style={[styles.companyAddress, { marginTop: space.md, color: color.yellow }]}>Last updated: August 2026</Text>
                </View>

                <Text style={styles.paragraph}>
                    This Privacy Policy explains how Hey Living Club Pty Ltd (ABN registered in Australia), trading as “Pawtchi” (“we”, “us”, “our”), collects, uses, stores, discloses and protects personal information when you use the Pawtchi mobile application and related services (the “App”).
                    {'\n\n'}We handle personal information in accordance with the Australian Privacy Act 1988 (Cth) and the Australian Privacy Principles (APPs), the New Zealand Privacy Act 2020 and the Information Privacy Principles (IPPs), and the developer privacy requirements of the Apple App Store and Google Play. This policy is written to be read together with the Pawtchi Terms of Service.
                </Text>

                <Text style={styles.sectionTitle}>1. Who we are and how to contact us</Text>
                <Text style={styles.paragraph}>
                    Hey Living Club Pty Ltd is the data controller for personal information collected through the App.
                    {'\n\n'}Our Privacy Officer can be reached at privacy@heylivingclub.com or at the postal address above. For any privacy question, access request, correction request or complaint, please contact us there. We aim to respond within 30 days.
                </Text>

                <Text style={styles.sectionTitle}>2. Information we collect</Text>
                <Text style={styles.paragraph}>
                    We only collect information that is reasonably necessary to run the features you use. We do not collect sensitive information about you as defined in the Privacy Act — we do not ask for your health information, race, religion, political views, sexual orientation or biometric data. Some of what we hold is health information about your pet, which we treat carefully but which is not “sensitive information” about a person.
                    {'\n\n'}<Text style={B}>Account information.</Text> When you create an account we collect your email address and a password, which is stored only in hashed form by our authentication provider. We do not ask for your legal name, date of birth or government identifiers. We do create a display name for your account by taking the part of your email address before the “@” — this appears on vet reports you export.
                    {'\n\n'}<Text style={B}>Pet profile information you provide.</Text> Your pet’s name, species, breed, sex, whether they are neutered, date of birth or age, current weight, body condition score, activity level, life stage, reproductive status, allergies or intolerances you record, medical conditions you record, diet type, and an optional pet profile photo. This is used to calculate feeding, hydration and activity targets and to personalise guidance.
                    {'\n\n'}<Text style={B}>Photos you submit.</Text> Photos of pet food, meals, treats, packaging labels and veterinary reports that you capture with the camera or select from your photo library, so the App can analyse them and return a verdict or extract structured information. If you add a photo of your pet, the App may also analyse that photo to estimate your pet’s body condition and suggest a starting point, which you can always change. Food and veterinary photos are sent for analysis and are not retained in our file storage; your pet’s profile photo is stored so it can be displayed in the App.
                    {'\n\n'}<Text style={B}>Activity and health logs.</Text> Meals logged, water logged, walks and other activities logged, weight entries and weight-plan assessments, milestones, streaks, ideal-weight estimates, AI-generated verdicts and vet-style answers, saved foods in your pantry, and vet-check-in responses.
                    {'\n\n'}<Text style={B}>Your daily routine.</Text> If you set up a personalised schedule we collect your usual wake time, bedtime, work start and finish times, preferred walk windows, how far your weekend shifts, your quiet hours, how much notification you want, and how many people in your household walk your pet. This is information about you, not your pet, and it is used only to place reminders at times that suit you.
                    {'\n\n'}<Text style={B}>Walk location data.</Text> Tracked walks are an optional feature you start deliberately. While a walk is running we collect your device’s precise location continuously — roughly one reading every three seconds or every five metres — to measure the route, distance, moving time, pace and rest stops.
                    {'\n'}• <Text style={B}>What we keep.</Text> A simplified version of the route path, the places where your pet paused or stopped to sniff, short place-name labels for the start, end and farthest points of the walk (obtained by reverse-geocoding those coordinates through your phone’s operating system), the weather at the time, and the walk’s timing and speed.
                    {'\n'}• <Text style={B}>Please be aware.</Text> Because a walk usually begins and ends at home, a stored route and its start label can indicate where you live, and a series of walks can show your usual routine. Only you can see your walks in the App.
                    {'\n'}• <Text style={B}>Background behaviour.</Text> So a walk is not lost when your screen locks, tracking continues in the background — on Android through a visible ongoing notification, and on iOS through the system background-location mode with the status indicator showing. Tracking continues even if you close the App, until the walk ends or you end it. We do not collect your location when a walk is not running, and we never request “always allow” background location permission.
                    {'\n'}• <Text style={B}>On your device.</Text> A high-detail trace is held on your device only while the walk is running and is erased when the walk finishes. If a finished walk cannot be uploaded straight away it waits on your device until it can be.
                    {'\n\n'}<Text style={B}>Insights we derive.</Text> From your walk history the App works out patterns — how often you repeat a route, roughly what time of day you head out, how many different places you visit, and how often you loop back home — and uses them to give your pet a “Walksign”, a character reading that can change over time. These are conclusions drawn from your movements, and we treat them as personal information.
                    {'\n\n'}<Text style={B}>Purchase information.</Text> If you subscribe, the payment itself is completed by Apple or Google and we never see your card details. We receive subscription entitlement status, plan identifier, purchase and renewal dates, and a subscriber identifier that is linked to your account so we can unlock premium features and restore purchases.
                    {'\n\n'}<Text style={B}>Rewards.</Text> Streak counts and paw-coin balances earned by logging activity.
                    {'\n\n'}<Text style={B}>Device and diagnostic information.</Text> Device model, operating system version, app version, language, time zone, an installation identifier, crash reports and IP-derived country. This is used for stability, security, fraud prevention and analytics. On Android, the App can also detect whether Instagram is installed, so it can offer to share a card there.
                    {'\n\n'}<Text style={B}>Product analytics.</Text> We record which screens you view and which actions you take — for example that onboarding was completed, that the paywall was viewed, or that a walk was started. These records are linked to your account identifier, not anonymous. Our analytics tool also captures interactions automatically, which means text shown on a screen you tap can be recorded. Some events deliberately include pet attributes such as breed, species, weight, body condition score and individual allergens, because we use them to improve guidance quality.
                    {'\n\n'}<Text style={B}>Push notification token.</Text> If you grant notification permission we store a push token against your account so we can deliver reminders and check-ins. You can revoke notification permission at any time in your device settings.
                    {'\n\n'}<Text style={B}>Support requests.</Text> If you write to us through Help &amp; Support we store the message you wrote, the topic and area you chose, and any screenshot you attach. We also attach technical details automatically so you do not have to describe them: your app version and build, device model, operating system version, language and time zone, the screen you were on, the error you saw, your subscription status, your pet&apos;s profile identifier, and the names of the last twenty-five actions the app took. Those action names are recorded without their details, so this trail does not include anything you have logged, any photo, or any location. Letters you send through Write to Founder carry the message and your app version only.
                    {'\n\n'}<Text style={B}>Advertising identifier.</Text> On iOS we present Apple’s App Tracking Transparency prompt, and the advertising identifier is used only if you tap “Allow”. On Android, our marketing measurement provider collects the device advertising identifier when the App starts. You can reset or limit that identifier in your Android settings.
                </Text>

                <Text style={styles.sectionTitle}>3. How we collect information (APP 3, IPP 2–4)</Text>
                <Text style={styles.paragraph}>
                    We collect information directly from you when you create an account, complete onboarding, log meals, log walks, submit photos, set your routine, ask a question or subscribe. Diagnostic and analytics data is collected automatically from your device as you use the App. Location is collected from your device while a tracked walk is running, and — with your permission, and only until your first walk records a location — as a single reading that centres the map on your home screen. To show the current temperature and walk outlook on Home, the map centre is rounded to roughly one kilometre and sent directly to Open-Meteo; it is not sent to Pawtchi’s servers for this purpose. We do not buy personal information from data brokers.
                </Text>

                <Text style={styles.sectionTitle}>4. Why we use your information (APP 6, IPP 10)</Text>
                <Text style={styles.paragraph}>
                    We use information for the primary purpose for which it was collected and for directly related secondary purposes you would reasonably expect, including:
                    {'\n'}• operating the food scanner, verdict engine, portion and hydration maths, activity tracking, walk tracking and vet-style Q&A;
                    {'\n'}• generating personalised feeding, hydration and activity plans, a current weather-based walk outlook, vet-ready PDF reports, walk stories and share cards;
                    {'\n'}• deriving the pattern-based insights described in section 2;
                    {'\n'}• delivering reminders, check-ins and streak notifications you have opted in to;
                    {'\n'}• processing subscriptions, restoring purchases and preventing subscription fraud;
                    {'\n'}• measuring product performance, crashes, funnel drop-off and marketing attribution so we can improve the App;
                    {'\n'}• complying with our legal obligations, including under the Privacy Act 1988 (Cth) and the Privacy Act 2020 (NZ).
                </Text>

                <Text style={styles.sectionTitle}>5. Third parties we share information with (APP 6, IPP 11)</Text>
                <Text style={styles.paragraph}>
                    We do not sell your personal information. We share the minimum information necessary with the following providers, each of which is bound by contract to protect it:
                    {'\n\n'}• <Text style={B}>Supabase</Text> — hosted database, authentication and file storage for your account, pet profiles, logs, walks, reports and pet profile photos.
                    {'\n'}• <Text style={B}>Google (Gemini API)</Text> — server-to-server analysis of photos and text so the App can return food verdicts, estimate body condition, parse veterinary reports and answer vet-style questions. When you ask a question, your pet’s profile — including recorded allergies, medical conditions, and diagnoses and medications extracted from any vet report you scanned — is included so the answer is specific to your animal.
                    {'\n'}• <Text style={B}>Google (Firebase Analytics)</Text> — measurement of key milestones such as sign-up, profile completion and purchases, linked to your account identifier.
                    {'\n'}• <Text style={B}>PostHog</Text> — product analytics and diagnostics, linked to your account identifier.
                    {'\n'}• <Text style={B}>Meta (Facebook App Events)</Text> — marketing attribution and measurement. A per-event property allowlist and a PII blocklist strip email, user id, pet name, breed and allergies before any event reaches Meta.
                    {'\n'}• <Text style={B}>RevenueCat</Text> — subscription entitlement, receipt validation and restore-purchase support, using an identifier linked to your account.
                    {'\n'}• <Text style={B}>Apple and Google (Play Billing)</Text> — payment processing for in-app subscriptions.
                    {'\n'}• <Text style={B}>Expo, Apple (APNs) and Google (FCM)</Text> — delivery of push notifications. Notification content can include your pet’s name and the reason for a health check-in.
                    {'\n'}• <Text style={B}>Resend</Text> — transactional email such as account confirmations. Also used to notify our own support team when you send a support request; that notification includes your email address, the start of your message, and the app version and platform it came from.
                    {'\n'}• <Text style={B}>OpenStreetMap Foundation</Text> — map tiles for the walk map. Tile requests reveal the approximate area you are viewing.
                    {'\n'}• <Text style={B}>Open-Meteo</Text> — weather at the time of a walk and the current temperature and walk outlook shown on Home. Coordinates are rounded to roughly one kilometre before they leave your device.
                    {'\n'}• <Text style={B}>Apple / Google (operating system geocoding)</Text> — converting walk coordinates into short place names, using your phone’s built-in service.
                    {'\n'}• <Text style={B}>Unsplash</Text> — stock images used as placeholder pet pictures.
                    {'\n\n'}We may also disclose information if required by law, to enforce our Terms of Service, or to protect the rights, property or safety of Pawtchi, our users or the public.
                </Text>

                <Text style={styles.sectionTitle}>6. Cross-border disclosure (APP 8, IPP 12)</Text>
                <Text style={styles.paragraph}>
                    Some providers listed above store or process personal information outside Australia and New Zealand. The countries in which recipients are likely to be located are the United States, Ireland, Germany and the United Kingdom.
                    {'\n\n'}Before disclosing personal information overseas we take reasonable steps to ensure the recipient handles it in a manner consistent with the APPs and the IPPs, including through written data-processing agreements.
                </Text>

                <Text style={styles.sectionTitle}>7. Direct marketing (APP 7)</Text>
                <Text style={styles.paragraph}>
                    We do not send unsolicited marketing emails. Email from us is transactional — account confirmation, password reset and similar. Push notifications are used for the reminders and check-ins you opted in to and can be turned off at any time in your device settings. We do not use your pet’s health information for advertising targeting.
                </Text>

                <Text style={styles.sectionTitle}>8. Device permissions</Text>
                <Text style={styles.paragraph}>
                    The App may request the following permissions. All are optional and can be revoked at any time in your device settings:
                    {'\n'}• <Text style={B}>Camera</Text> — to scan pet food and veterinary documents.
                    {'\n'}• <Text style={B}>Photo library</Text> — to select a pet profile photo or an existing food photo. The App may also save a scanned food image back to your library.
                    {'\n'}• <Text style={B}>Location (while in use)</Text> — to record tracked walks. Tracking continues in the background while a walk is active, shown by an ongoing notification on Android and the status indicator on iOS. We do not request “always allow” background location.
                    {'\n'}• <Text style={B}>Notifications</Text> — to deliver reminders, activity nudges and vet check-ins.
                    {'\n'}• <Text style={B}>App Tracking Transparency (iOS)</Text> — required by Apple before any cross-app tracking identifier is used.
                </Text>

                <Text style={styles.sectionTitle}>9. Anonymity and pseudonymity (APP 2)</Text>
                <Text style={styles.paragraph}>
                    Wherever it is lawful and practicable, you may deal with us anonymously or under a pseudonym. In practice the App requires an email address so your pet’s records can be kept securely, synced to your devices and restored if you reinstall — so an account cannot be anonymous. You are welcome to use a pseudonymous email address and a nickname for your pet. You can contact us anonymously with a general privacy enquiry, though we may be unable to action an access or correction request without verifying who you are.
                </Text>

                <Text style={styles.sectionTitle}>10. Data quality (APP 10, IPP 8)</Text>
                <Text style={styles.paragraph}>
                    We take reasonable steps to ensure the personal information we hold is accurate, up to date, complete and relevant. You can review and update your account, pet and routine information at any time from the Profile tab.
                </Text>

                <Text style={styles.sectionTitle}>11. Security (APP 11, IPP 5)</Text>
                <Text style={styles.paragraph}>
                    We use technical and organisational measures to protect your information, including encryption in transit (TLS), encryption at rest on our infrastructure providers, hashed passwords, row-level security so each account can only reach its own records, restricted staff access on a need-to-know basis, and rate limiting on our server functions.
                    {'\n\n'}You should also know:
                    {'\n'}• Your pet’s profile photo is served from a public web address. The address is long and effectively unguessable, but anyone you give it to can open it without signing in.
                    {'\n'}• Some information — your sign-in session, an unsent walk and vet reports you have exported to PDF — is held in your device’s own storage, protected by your device’s security rather than by ours.
                    {'\n\n'}No system is perfectly secure. If we become aware of an eligible data breach likely to result in serious harm, we will notify affected users and the Office of the Australian Information Commissioner (OAIC) as required under the Notifiable Data Breaches scheme, and the Office of the Privacy Commissioner (NZ) as required under the Privacy Act 2020.
                </Text>

                <Text style={styles.sectionTitle}>12. Retention and deletion</Text>
                <Text style={styles.paragraph}>
                    We keep personal information only for as long as we need it to provide the App or as required by law.
                    {'\n'}• <Text style={B}>Account deletion.</Text> When you delete your account from the Profile screen we permanently delete your account, pet profiles, logs, photos, walks and routes, saved foods, veterinary documents and reports from our operational data stores.
                    {'\n'}• <Text style={B}>Individual records.</Text> You can delete individual food scans, saved pantry foods and veterinary reports from within the App at any time. Walks cannot currently be deleted individually; they are removed when the pet or the account is deleted.
                    {'\n'}• <Text style={B}>Retention periods.</Text> We do not currently apply a fixed retention period. Walk routes and location detail, and your other pet records, are kept for the life of the account and are deleted when you delete the pet or the account.
                    {'\n'}• <Text style={B}>What survives deletion.</Text> Financial records we must keep for tax and audit purposes are retained for the period required by law. Analytics and marketing records held by our providers are keyed to your account identifier and are removed on request — contact us if you want them erased at the same time as your account.
                </Text>

                <Text style={styles.sectionTitle}>13. Your rights — access, correction and complaints (APP 12/13, IPP 6/7)</Text>
                <Text style={styles.paragraph}>
                    You have the right to ask for access to the personal information we hold about you and to ask that it be corrected. Most information is directly viewable and editable inside the App. For anything else, email privacy@heylivingclub.com.
                    {'\n'}• We do not charge for making a request, or for correcting information.
                    {'\n'}• We will ask you to verify your identity — normally by writing from the email address on the account — before we release or change anything.
                    {'\n'}• We will respond within 30 days.
                    {'\n'}• If we refuse a request in whole or in part we will tell you why in writing and explain how to complain.
                    {'\n\n'}If you believe we have breached the Australian Privacy Principles or the New Zealand Information Privacy Principles, please contact us first so we can try to resolve it. If you are not satisfied you may complain to:
                    {'\n'}• Office of the Australian Information Commissioner (OAIC) — oaic.gov.au or 1300 363 992.
                    {'\n'}• Office of the Privacy Commissioner (New Zealand) — privacy.org.nz or 0800 803 909.
                </Text>

                <Text style={styles.sectionTitle}>14. Automated processing and AI</Text>
                <Text style={styles.paragraph}>
                    Pawtchi uses automated processing, including AI models, to produce food verdicts, estimate body condition from a photo, calculate feeding and weight plans, generate vet-style answers and derive the insights described in section 2. These outputs are guidance for you to consider — they are not veterinary advice, they do not make decisions about you, and they do not affect your legal rights or your access to any service. You can always override a suggestion, and you should consult a veterinarian for anything clinical.
                </Text>

                <Text style={styles.sectionTitle}>15. Sharing content from the App</Text>
                <Text style={styles.paragraph}>
                    The App lets you share walk stories, milestone cards and invitations to friends and to social apps such as Instagram. When you choose to share:
                    {'\n'}• a walk or story card can include your pet’s name, a drawing of your walking route and a place-name label — and, because walks usually start at home, this can indicate the area you live in;
                    {'\n'}• an invitation message includes your pet’s name;
                    {'\n'}• once shared, that content is handled by whichever app or service you sent it to, under their privacy policy, not ours.
                    {'\n\n'}Sharing is always your choice — nothing is posted anywhere on your behalf.
                </Text>

                <Text style={styles.sectionTitle}>16. Subscriptions and billing</Text>
                <Text style={styles.paragraph}>
                    All subscription purchases are processed by Apple or Google. Financial data (card number, billing address) is handled directly by them and is never received by Hey Living Club Pty Ltd. You can manage or cancel subscriptions from your device: on iOS via Settings → Apple ID → Subscriptions; on Android via Google Play Store → Payments &amp; subscriptions → Subscriptions.
                </Text>

                <Text style={styles.sectionTitle}>17. Children</Text>
                <Text style={styles.paragraph}>
                    Pawtchi is not directed to children under 13, and we do not knowingly collect personal information from children. If you believe a child has provided us with personal information, please contact privacy@heylivingclub.com and we will delete it.
                </Text>

                <Text style={styles.sectionTitle}>18. Apple App Store and Google Play disclosures</Text>
                <Text style={styles.paragraph}>
                    We publish an Apple Privacy Nutrition Label and a Google Play Data Safety declaration alongside this policy. Those disclosures reflect the same data categories described here: contact info (email); user content (photos of food and veterinary reports, pet profile photo); health &amp; fitness (pet weight, body condition, activity); identifiers (installation and subscriber identifiers linked to your account); purchases; location (precise, while a walk is active and for a single reading that centres the home screen map before your first walk); app activity; and diagnostics. We do not sell your data.
                </Text>

                <Text style={styles.sectionTitle}>19. Changes to this policy</Text>
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
