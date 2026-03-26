# Product Requirements Document (PRD)

**Version:** 0.1
**Product Type:** AI-powered gamified pet health platform
**Primary Market:** Australia
**Primary Platform:** Mobile (iOS + Android)

---

## 1. Product Vision

### Vision Statement
Pawtchi is a daily habit platform that helps pet owners maintain optimal pet health through intelligent nutrition tracking, behaviour reinforcement, and gamified engagement.

### Product Goal
Transform pet feeding from guesswork into a precise, engaging, and rewarding daily health habit.

### Success Metric (Primary KPI)
**North Star Metric:** % of pets maintaining healthy weight range

**Supporting KPIs:**
- Daily active users (DAU)
- 7-day retention
- Food logging frequency
- Streak completion rate
- Weight improvement trends

---

## 2. Problem Definition

### Primary Problems
Pet obesity caused by:
- Inaccurate portion estimation
- Treat overfeeding
- Multiple household feeding
- Lack of calorie awareness
- Poor habit consistency
- Tracking friction

### User Pain Points
- "I don't know how much to feed."
- "I forget treats count."
- "Tracking is annoying."
- "My vet says lose weight but how?"
- "Family overfeeds."
- "I want reassurance I'm doing right."

---

## 3. Target Users

### Primary Users
- Pet owners aged 22–50
- Urban/suburban
- Dogs and cats
- Health conscious
- Treat pets as family
- Tech comfortable

### Secondary Users
- Overweight pet owners
- First time pet parents
- Vet recommended users
- Multi-pet households

---

## 4. Core Product Principles

All development decisions must follow:
- **Principle 1:** Reduce friction to log food.
- **Principle 2:** Reward honesty, not perfection.
- **Principle 3:** Make health feel like a game.
- **Principle 4:** Provide decision support not just tracking.
- **Principle 5:** Build daily habit loop.

---

## 5. Core User Flow

### Primary Daily Loop

**Step 1 – Trigger:** User opens app at feeding time.
**Step 2 – Action:** User logs Food (AI scan), Treat, Walk, Water, Weight update.
**Step 3 – Processing:** System calculates Calories consumed, Remaining calories, Goal progress.
**Step 4 – Feedback:** Pet avatar reacts. Progress shown visually.
**Step 5 – Reward:** Coins awarded. Streak updated. Achievements unlocked.
**Step 6 – Investment:** User spends coins. Customizes pet. Builds attachment.
*Loop repeats daily.*

---

## 6. Core Feature Set (MVP)

### Feature 1 – Pet Profile System
**Required data:** Pet name, Species, Breed, Age, Weight, Target weight, Sex, Neutered status, Activity level, Health conditions (optional).
**Output:** Daily calorie target, Weight trend target, Protein needs, Water needs.

**Calculation engine:** Use veterinary RER formula:
`RER = 70 × (weight kg ^ 0.75)`
Maintenance: `RER × factor`
- Neutered adult: 1.6
- Intact adult: 1.8
- Weight loss: 1.0
- Weight gain: 1.2–1.4

### Feature 2 – AI Food Logging
**Methods:** Camera food recognition, Barcode scanner, Manual search, Quick add buttons.
**AI Scanner Requirements:** Detect Kibble, Wet food, Mixed bowls, Treats. Estimate Food type, Volume estimate, Calorie estimate, Confidence score.
*If confidence low: Prompt manual confirmation.*

**Data Structure:**
Food Item: ID, Brand, Product name, Calories per gram, Category, Barcode, Image reference.

### Feature 4 – Daily Calorie Engine
**Track:** Food calories, Treat calories, Remaining allowance, Goal percentage.
**Show:** Used, Remaining, Overage adjustment.
**Visual:** Circular progress bar.

### Feature 5 – Gamification Engine
**Reward System** (Coins earned from): Daily logging, Goal completion, 7-day streak, Weight milestone, Activity logging, Honest logging.

### Feature 6 – Virtual Pet Avatar
**User chooses:** Breed match, Color, Name, Gender.
**Avatar reacts to:** Goal completion, Treat logging, Overfeeding adjustment, Streaks.
**Emotions:** Happy, Excited, Sleepy, Proud, Concerned (gentle tone).
**Cost:** Coins only. No pay to win.

### Feature 8 – Weight Tracking
**User enters:** Weekly weight.
**Graph shows:** Trend, Target zone, Projected weight, Health band visualization.
**Show:** Healthy zone (green), Overweight (yellow), Risk (red). Avoid shame messaging.

### Feature 9 – Treat Intelligence
**When treat logged:** App shows % of daily calories, then suggests Dinner reduction.
**Tone:** Supportive. Never negative.

### Feature 10 – Streak System
**Tracks:** Daily logging, Goal completion, Weight entry.
**Rewards:** 3 day streak, 7 day streak, 30 day streak.
**Streak break:** Encourage restart. Never punish.

---

## 7. Secondary Features (Post MVP)
Family sync, Vet share reports, Weight prediction AI, Smart feeding alerts, Behaviour insights, Smart reminders, Activity tracking, Apple Health integration.

---

## 8. AI Systems Required
**Primary AI Engine:** Google Gemini (Pro/Vision)
**AI modules:** Food recognition model, Calorie estimation engine, Weight prediction model, Recommendation engine.
**Future:** Behaviour prediction, Health risk alerts, Treat adjustment AI.

---

## 9. Data Architecture
**Core Entities:** User, Pet, Food, Meal, Treat, Activity, Weight, Reward, Inventory items.
**Key relationships:** User → Pets, Pet → Meals, Pet → Weight, Pet → Activities, Pet → Rewards.
**Backend:** Supabase (PostgreSQL, Auth, Storage)
**API Layer:** Supabase Edge Functions (TypeScript)
**AI Integration:** Gemini API (Node/Edge integration)
**Database:** PostgreSQL (via Supabase), Food DB relational.
**Services:** Supabase Storage (images), Edge Functions (API calling), Supabase Auth, Push notifications, Analytics.

---

## 11. Monetization Strategy
**Freemium model.**
- **Free tier:** Tracking, Avatar, Basic rewards.
- **Premium:** Advanced AI insights, Vet reports, Unlimited pets, Weight prediction, Advanced analytics, Family sync.
**Pricing:** $6–10/month.

---

## 13. Behaviour Psychology Rules
**Always:** Reward logging. Never punish logging.
**Encourage:** Consistency. Honesty. Small improvements.
**Avoid:** Red warnings. Guilt messaging. Negative comparisons.

---

## 14. Security & Privacy
**Required:** User auth, Pet data encryption, Image storage protection, GDPR compliance, Australia privacy compliance. No selling personal data.

---

## 15. Development Phases
### Phase 1 (3–4 months)
Core MVP: Pet profile, Food logging, Calorie engine, Avatar basic, Streak system, Weight tracking.
### Phase 2
Gamification expansion, AI scanner improvement, Treat intelligence, Analytics.
### Phase 3
Prediction AI, Family sync.

---

## 16. Success Criteria for MVP
Launch ready when:
- Food logging works reliably.
- Calorie engine accurate.
- Daily loop engaging.
- Streak system stable.
- Basic retention >25% D7.
- Users log daily meals.

**Product Development Rules**
- DO build: Daily loop first.
