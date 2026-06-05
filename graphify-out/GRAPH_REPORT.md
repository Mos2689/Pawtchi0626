# Graph Report - my-app  (2026-06-05)

## Corpus Check
- 144 files · ~110,449 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 818 nodes · 1300 edges · 60 communities (52 shown, 8 thin omitted)
- Extraction: 98% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 19 edges (avg confidence: 0.8)
- Token cost: 91,006 input · 1,500 output

## Community Hubs (Navigation)
- [[_COMMUNITY_AAFCO Cat Nutrient Profiles|AAFCO Cat Nutrient Profiles]]
- [[_COMMUNITY_Pet Onboarding & Profile Store|Pet Onboarding & Profile Store]]
- [[_COMMUNITY_Expo App Config|Expo App Config]]
- [[_COMMUNITY_AAFCO Dog Nutrient Profiles|AAFCO Dog Nutrient Profiles]]
- [[_COMMUNITY_Runtime Dependencies|Runtime Dependencies]]
- [[_COMMUNITY_HealthActivity Screens + Supabase|Health/Activity Screens + Supabase]]
- [[_COMMUNITY_Dev Tooling & Scripts|Dev Tooling & Scripts]]
- [[_COMMUNITY_Weekly Summary Email|Weekly Summary Email]]
- [[_COMMUNITY_EAS Build Config|EAS Build Config]]
- [[_COMMUNITY_Pet Context & Nudge Engine|Pet Context & Nudge Engine]]
- [[_COMMUNITY_Auth & Primary Button|Auth & Primary Button]]
- [[_COMMUNITY_Welcome Email|Welcome Email]]
- [[_COMMUNITY_Food Verdict Engine|Food Verdict Engine]]
- [[_COMMUNITY_Typography & Header|Typography & Header]]
- [[_COMMUNITY_Themed UI Primitives|Themed UI Primitives]]
- [[_COMMUNITY_Profile  Shop  Streak Store|Profile / Shop / Streak Store]]
- [[_COMMUNITY_Home Screen & Nudge Card|Home Screen & Nudge Card]]
- [[_COMMUNITY_Clinical Nutrient Adjustments|Clinical Nutrient Adjustments]]
- [[_COMMUNITY_Meal Logging & Pantry|Meal Logging & Pantry]]
- [[_COMMUNITY_Walkthrough Tour|Walkthrough Tour]]
- [[_COMMUNITY_AAFCO Math & Health Score|AAFCO Math & Health Score]]
- [[_COMMUNITY_Theme & Icon Symbols|Theme & Icon Symbols]]
- [[_COMMUNITY_Subscription & Paywall|Subscription & Paywall]]
- [[_COMMUNITY_Referral  Invite Feature|Referral / Invite Feature]]
- [[_COMMUNITY_Nutrition Reference & Scan Result|Nutrition Reference & Scan Result]]
- [[_COMMUNITY_Deferred Clinical Conditions|Deferred Clinical Conditions]]
- [[_COMMUNITY_Button  Card  Community UI|Button / Card / Community UI]]
- [[_COMMUNITY_AU Seed Foods Pantry|AU Seed Foods Pantry]]
- [[_COMMUNITY_Onboarding Screen Flow (mockups)|Onboarding Screen Flow (mockups)]]
- [[_COMMUNITY_Clinical Condition Mapping|Clinical Condition Mapping]]
- [[_COMMUNITY_Verdict Generation|Verdict Generation]]
- [[_COMMUNITY_Email & CORS Shared|Email & CORS Shared]]
- [[_COMMUNITY_Reset Project Script|Reset Project Script]]
- [[_COMMUNITY_TypeScript Config|TypeScript Config]]
- [[_COMMUNITY_Pantry Pill Selector|Pantry Pill Selector]]
- [[_COMMUNITY_Weekly Nutrition Chart|Weekly Nutrition Chart]]
- [[_COMMUNITY_Allergen Matcher|Allergen Matcher]]
- [[_COMMUNITY_Activity Contextualizer|Activity Contextualizer]]
- [[_COMMUNITY_Vet Report Freshness|Vet Report Freshness]]
- [[_COMMUNITY_Wearables Upload Script|Wearables Upload Script]]
- [[_COMMUNITY_Brand Data|Brand Data]]
- [[_COMMUNITY_Activity Burn Estimator|Activity Burn Estimator]]
- [[_COMMUNITY_VS Code Settings|VS Code Settings]]
- [[_COMMUNITY_Circular Progress|Circular Progress]]
- [[_COMMUNITY_Liquid Fill Card|Liquid Fill Card]]
- [[_COMMUNITY_Gemini Test Script v2|Gemini Test Script v2]]
- [[_COMMUNITY_Gemini Test Script v3|Gemini Test Script v3]]
- [[_COMMUNITY_Gemini Test Script|Gemini Test Script]]
- [[_COMMUNITY_Coin Rewards (update-streak)|Coin Rewards (update-streak)]]
- [[_COMMUNITY_Privacy Screen|Privacy Screen]]
- [[_COMMUNITY_ESLint Config|ESLint Config]]
- [[_COMMUNITY_Edge Function CORS|Edge Function CORS]]
- [[_COMMUNITY_Edge Function CORS|Edge Function CORS]]
- [[_COMMUNITY_Edge Function CORS|Edge Function CORS]]
- [[_COMMUNITY_VS Code Extensions|VS Code Extensions]]

## God Nodes (most connected - your core abstractions)
1. `useAuth()` - 25 edges
2. `Colors` - 22 edges
3. `useActivePetStore` - 21 edges
4. `analyzeFood()` - 18 edges
5. `useStreakStore` - 17 edges
6. `expo` - 16 edges
7. `PawtchiButton()` - 16 edges
8. `useSubscription()` - 16 edges
9. `supabase` - 16 edges
10. `usePetContextStore` - 13 edges

## Surprising Connections (you probably didn't know these)
- `RootLayoutNav()` --calls--> `useColorScheme()`  [INFERRED]
  app/_layout.tsx → hooks/use-color-scheme.web.ts
- `WelcomeScreen()` --calls--> `useAuth()`  [EXTRACTED]
  app/index.tsx → providers/AuthProvider.tsx
- `InviteScreen()` --calls--> `useActivePetStore`  [EXTRACTED]
  app/invite.tsx → store/useActivePetStore.ts
- `OwnerProfileScreen()` --calls--> `useAuth()`  [EXTRACTED]
  app/owner.tsx → providers/AuthProvider.tsx
- `PaywallScreen()` --calls--> `useActivePetStore`  [EXTRACTED]
  app/paywall.tsx → store/useActivePetStore.ts

## Hyperedges (group relationships)
- **Onboarding Flow: Welcome to Health Goal** — welcome_screen, species_screen, vitals_screen, goal_screen [INFERRED 0.85]
- **Main App Bottom Navigation Flow** — home_screen, log_screen, health_screen, profile_screen [INFERRED 0.85]

## Communities (60 total, 8 thin omitted)

### Community 0 - "AAFCO Cat Nutrient Profiles"
Cohesion: 0.05
Nodes (50): ca_p_ratio, calcium, crude_fat, crude_fiber, crude_protein, phosphorus, taurine_dry, taurine_wet (+42 more)

### Community 1 - "Pet Onboarding & Profile Store"
Cohesion: 0.07
Nodes (39): BreedDefaults, CAT_BREED_DATA, DOG_BREED_DATA, getBreedDefaults(), getMixedBreedDefaults(), SizeCategory, sizeCategoryFromWeight(), ActivityLevel (+31 more)

### Community 2 - "Expo App Config"
Cohesion: 0.04
Nodes (44): backgroundColor, foregroundImage, adaptiveIcon, edgeToEdgeEnabled, package, permissions, predictiveBackGestureEnabled, versionCode (+36 more)

### Community 3 - "AAFCO Dog Nutrient Profiles"
Cohesion: 0.07
Nodes (40): ca_p_ratio, calcium, crude_fat, crude_fiber, crude_protein, phosphorus, max, min (+32 more)

### Community 4 - "Runtime Dependencies"
Cohesion: 0.05
Nodes (40): dependencies, expo, expo-constants, expo-device, expo-font, expo-haptics, expo-image, expo-image-picker (+32 more)

### Community 5 - "Health/Activity Screens + Supabase"
Cohesion: 0.10
Nodes (22): styles, ModalAction, PawtchiModal(), PawtchiModalProps, PawtchiSuccessModal(), styles, SuccessModalProps, { width: SCREEN_WIDTH } (+14 more)

### Community 6 - "Dev Tooling & Scripts"
Cohesion: 0.07
Nodes (27): devDependencies, eslint, eslint-config-expo, jest, ts-jest, @types/jest, @types/react, typescript (+19 more)

### Community 7 - "Weekly Summary Email"
Cohesion: 0.08
Nodes (25): button, buttonContainer, container, divider, footer, footerCopyright, footerText, header (+17 more)

### Community 8 - "EAS Build Config"
Cohesion: 0.09
Nodes (24): buildType, serviceAccountKeyPath, track, build, development, preview, production, cli (+16 more)

### Community 9 - "Pet Context & Nudge Engine"
Cohesion: 0.11
Nodes (17): adjustDailyTarget(), computeNudge(), Nudge, NudgeInput, Pet, ActivitySummary, ClinicalContext, computeDerived() (+9 more)

### Community 10 - "Auth & Primary Button"
Cohesion: 0.13
Nodes (15): styles, WelcomeScreen(), OwnerProfileScreen(), styles, Props, styles, ButtonSize, ButtonVariant (+7 more)

### Community 11 - "Welcome Email"
Cohesion: 0.10
Nodes (20): button, buttonContainer, container, divider, footer, footerCopyright, footerLinks, footerText (+12 more)

### Community 12 - "Food Verdict Engine"
Cohesion: 0.16
Nodes (19): AAFCOProfile, analyzeFood(), applyAdjustments(), ClinicalAdjustmentEntry, FoodVerdictInput, getProfile(), humanLabel(), LifeStageProfile (+11 more)

### Community 13 - "Typography & Header"
Cohesion: 0.15
Nodes (12): styles, styles, Header(), HeaderProps, styles, TextColor, TextVariant, TextWeight (+4 more)

### Community 14 - "Themed UI Primitives"
Cohesion: 0.17
Nodes (12): styles, ParallaxScrollView(), Props, styles, styles, ThemedText(), ThemedTextProps, ThemedView() (+4 more)

### Community 15 - "Profile / Shop / Streak Store"
Cohesion: 0.18
Nodes (14): CoinToast(), MILESTONE_MESSAGES, styles, useActivePetStore, EarnEvent, REASON_LABELS, StreakState, useStreakStore (+6 more)

### Community 16 - "Home Screen & Nudge Card"
Cohesion: 0.15
Nodes (12): iconMap, NudgeCard(), NudgeCardProps, routeMap, styles, usePushNotifications(), usePetContextStore, HomeScreen() (+4 more)

### Community 17 - "Clinical Nutrient Adjustments"
Cohesion: 0.12
Nodes (18): conditions, obesity, pancreatitis_history, rationale, target_max_g_per_1000kcal, multiplier, note, use_target_weight (+10 more)

### Community 18 - "Meal Logging & Pantry"
Cohesion: 0.19
Nodes (11): FOOD_TYPE_ICONS, Props, styles, computePantryMacros(), DEFAULT_SERVING_GRAMS, MacroResult, pantryItemToScanResult(), SyntheticScanResult (+3 more)

### Community 19 - "Walkthrough Tour"
Cohesion: 0.15
Nodes (12): RootLayoutNav(), unstable_settings, AuthProvider(), styles, useWalkthrough(), WALKTHROUGH_STEPS, WalkthroughContext, WalkthroughContextType (+4 more)

### Community 20 - "AAFCO Math & Health Score"
Cohesion: 0.22
Nodes (12): caPhosphorusRatio(), defaultMoisturePct(), estimateKcalPer100g(), gramsPer1000kcal(), kcalPer100gDryMatter(), toDryMatterBasis(), computeHealthScore(), HealthScoreInput (+4 more)

### Community 21 - "Theme & Icon Symbols"
Cohesion: 0.19
Nodes (9): ExternalLink(), Props, Fonts, styles, styles, IconMapping, IconSymbol(), IconSymbolName (+1 more)

### Community 22 - "Subscription & Paywall"
Cohesion: 0.18
Nodes (12): deriveMode(), MODE_CONFIG, ModeContent, PaywallMode, PaywallScreen(), styles, styles, TrialBanner() (+4 more)

### Community 23 - "Referral / Invite Feature"
Cohesion: 0.27
Nodes (10): InviteScreen(), styles, buildInviteBody(), buildInviteHeadline(), buildInviteMessage(), buildInviteSubcopy(), cleanName(), InvitePet (+2 more)

### Community 24 - "Nutrition Reference & Scan Result"
Cohesion: 0.16
Nodes (10): NUTRIENT_LABEL, Props, STATUS_ICON, styles, FoodAnalysis, NutrientStatus, VerdictContext, FoodScanDetails (+2 more)

### Community 25 - "Deferred Clinical Conditions"
Cohesion: 0.14
Nodes (14): deferred_reason, requires_vet_review, deferred_reason, requires_vet_review, _deferred_conditions, ckd_stage_2, ckd_stage_3, diabetes (+6 more)

### Community 26 - "Button / Card / Community UI"
Cohesion: 0.18
Nodes (8): baseStyles, Button(), ButtonProps, ButtonVariant, CardProps, styles, Colors, styles

### Community 27 - "AU Seed Foods Pantry"
Cohesion: 0.24
Nodes (8): disclaimer, foods, source_note, version, listSeedFoods(), lookupSeedFood(), normalize(), SeedFood

### Community 28 - "Onboarding Screen Flow (mockups)"
Cohesion: 0.29
Nodes (11): Activity Timeline Screen, Create Profile / Pet Details Screen, Set Health Goal Screen, Health Hub Screen, Home Dashboard Screen, Log / AI Scanner Screen, Pet Profile Screen, Expo App README (+3 more)

### Community 29 - "Clinical Condition Mapping"
Cohesion: 0.24
Nodes (8): _design_note, disclaimer, user_confirmation_required, version, hasMappedCondition(), mapMedicalConditionsToAdjustmentKeys(), Pattern, PATTERNS

### Community 30 - "Verdict Generation"
Cohesion: 0.31
Nodes (8): cleanAllergenNames(), generateVerdict(), nutrientGPer1000(), nutrientStatus(), ScanResultVerdict, makeCtx(), makeFoodAnalysis(), tests

### Community 31 - "Email & CORS Shared"
Cohesion: 0.33
Nodes (4): WeeklySummaryEmail(), WelcomeEmail(), resend, corsHeaders

### Community 32 - "Reset Project Script"
Cohesion: 0.22
Nodes (7): exampleDirPath, fs, oldDirs, path, readline, rl, root

### Community 33 - "TypeScript Config"
Cohesion: 0.29
Nodes (6): compilerOptions, paths, strict, extends, include, @/*

### Community 34 - "Pantry Pill Selector"
Cohesion: 0.33
Nodes (4): FOOD_TYPE_ICONS, PantryItem, Props, styles

### Community 35 - "Weekly Nutrition Chart"
Cohesion: 0.33
Nodes (3): DayMacro, styles, WeeklyNutritionChartProps

### Community 36 - "Allergen Matcher"
Cohesion: 0.47
Nodes (3): AllergenMatch, detectAllergens(), escapeRegex()

### Community 37 - "Activity Contextualizer"
Cohesion: 0.47
Nodes (4): contextualizeWalk(), contextualizeWater(), getPetSize(), PetSize

### Community 38 - "Vet Report Freshness"
Cohesion: 0.40
Nodes (4): FreshnessResult, FreshnessStatus, getReportFreshness(), NOW

### Community 39 - "Wearables Upload Script"
Cohesion: 0.33
Nodes (4): { createClient }, fs, supabase, uploads

### Community 40 - "Brand Data"
Cohesion: 0.40
Nodes (4): BOWL_SIZES, KIBBLE_BRANDS, TREAT_BRANDS, WET_FOOD_BRANDS

### Community 41 - "Activity Burn Estimator"
Cohesion: 0.50
Nodes (4): ActivityArchetype, BURN_RATES, computeBurnSummary(), estimateActivityBurn()

### Community 42 - "VS Code Settings"
Cohesion: 0.40
Nodes (4): editor.codeActionsOnSave, source.fixAll, source.organizeImports, source.sortMembers

### Community 45 - "Gemini Test Script v2"
Cohesion: 0.50
Nodes (3): env, fs, keyMatch

### Community 46 - "Gemini Test Script v3"
Cohesion: 0.50
Nodes (3): env, fs, keyMatch

### Community 47 - "Gemini Test Script"
Cohesion: 0.50
Nodes (3): env, fs, keyMatch

### Community 48 - "Coin Rewards (update-streak)"
Cohesion: 0.50
Nodes (3): COIN_REWARDS, corsHeaders, MILESTONE_BONUSES

## Ambiguous Edges - Review These
- `Expo App README` → `Home Dashboard Screen`  [AMBIGUOUS]
  my-app/README.md · relation: conceptually_related_to

## Knowledge Gaps
- **406 isolated node(s):** `name`, `slug`, `version`, `orientation`, `icon` (+401 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Expo App README` and `Home Dashboard Screen`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What connects `name`, `slug`, `version` to the rest of the system?**
  _406 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `AAFCO Cat Nutrient Profiles` be split into smaller, more focused modules?**
  _Cohesion score 0.05411764705882353 - nodes in this community are weakly interconnected._
- **Should `Pet Onboarding & Profile Store` be split into smaller, more focused modules?**
  _Cohesion score 0.07397959183673469 - nodes in this community are weakly interconnected._
- **Should `Expo App Config` be split into smaller, more focused modules?**
  _Cohesion score 0.044444444444444446 - nodes in this community are weakly interconnected._
- **Should `AAFCO Dog Nutrient Profiles` be split into smaller, more focused modules?**
  _Cohesion score 0.07317073170731707 - nodes in this community are weakly interconnected._
- **Should `Runtime Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._