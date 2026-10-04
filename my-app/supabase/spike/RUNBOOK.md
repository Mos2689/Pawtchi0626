# Live Walk v2: Phase A device spike runbook

This branch (`spike/live-walk-a`) is throwaway: never merge it, and never send its build for App Store review. It exists to answer the questions below on real phones before the new live-walk design is built on top of those answers.

## What the spike answers

When a phone is **locked**, both while walking and while standing still:

1. Do location updates keep arriving?
2. Does the realtime connection stay open, and do its heartbeats keep going?
3. Does the other phone keep seeing this one as "here" (Presence)? If the connection drops, how long until it notices?
4. Do messages from the locked phone still get through?
5. When the login token expires during the lock, does it renew, and does the room survive?
6. Do the app's own timers keep firing?

Plus three server checks:

7. Do database changes arrive through a private room?
8. Is a private room invisible to anyone who joins without permission?
9. How long does the server take to confirm a message?

## What you need

- Two phones, ideally one iPhone and one Android, each signed into a **different** Pawtchi account.
- A meetup that both accounts belong to (for the walking runs).
- About 3 hours across a few days: two walks of about 45 minutes, plus two 25-minute "phone on the table" runs.

## Step 1: Open the temporary server room (5 minutes)

1. In Supabase → SQL editor, paste and run `supabase/spike/live_walk_spike_setup.sql`.
2. Edit the two emails in this statement and run it on its own:
   ```sql
   insert into private.live_spike_testers (user_id)
   select id from auth.users where email in ('first@example.com', 'second@example.com')
   on conflict do nothing;
   ```
3. Check: `select count(*) from private.live_spike_testers;` should return 2.

This touches no app tables. It only lets those two accounts use rooms named `spike:…`.

## Step 2: Build (from this branch)

The spike build uses build number **100**. The next real store build (from `fix/connect-resilience`) must therefore use **101**.

```bash
git checkout spike/live-walk-a
```

```bash
eas build -p ios --profile spike-ios
```

```bash
eas submit -p ios --latest
```

In App Store Connect → TestFlight, give it to **internal testers only**. Don't add it to a review submission.

```bash
eas build -p android --profile spike-android
```

On Android, install the APK from the link EAS gives you.

## Step 3: Open the recorder

On each phone, open `pawtchi://dev-live-spike`. You can type it into Safari or Chrome, or tap it in a note. In a normal build this screen is blank. In the spike build it shows the recorder.

Both phones use the same **Room** name (for example `a1`).

## Step 4: The runs

Before each run, look at **"token expires in"** on the locked phone after pressing Start. The login token has to expire *during* the lock. If more time is left than the run will last, wait or come back later.

Tap the note buttons as you go ("Locking now", "Unlocked", and so on). They are what lets us line the logs up afterwards.

### Run W: walking, locked (do it twice: once with the iPhone walking, once with the Android)

1. **Walker phone:** start a meetup walk the normal way, with location sharing on. Open the recorder:
   - the meetup id is filled in automatically;
   - choose **walker**, press **Start**.
2. **Watching phone:** stays home on charge with the screen on (set Auto-Lock to Never), the recorder open:
   - same room;
   - choose **viewer**, press **Start**.
3. Check "token expires in" on the walker phone. If it's under about 35 minutes, tap **Locking now**, lock the phone and walk for **45 minutes or more** without unlocking it. Otherwise, wait.
4. While the walker is out, on the **watching phone**:
   - press **Public join**, wait 45 seconds;
   - then press **Signed-out private**, wait 45 seconds.
5. Back home, unlock the walker phone:
   - tap **Unlocked**;
   - finish the walk normally;
   - press **Stop** on both phones.

### Run S: standing still, locked (twice: once per phone as the still one)

1. **Still phone:** start a walk (solo is fine), open the recorder:
   - **walker**, **Start**;
   - wait until "token expires in" is **under 15 minutes**.
2. **Watching phone:** as in Run W.
3. On the still phone, tap **Standing still**, then **Locking now**. Lock it and leave it on a table for **25 minutes**.
4. Unlock, tap **Unlocked**, then press **Stop** on both phones.

Expect the walk itself to end on its own during this run. A walk stops by itself after about 10 minutes without movement (longer for some dogs). That's existing behaviour, and the log records exactly when it happened. It also matters for the design: a "standing still, locked" walker only exists for that window.

### Optional: a third account

Sign into an account that isn't one of the two testers. Open the recorder and press Start. The channel line should end in an error, not "joined".

## Step 5: Send the results back

After each run, on **each** phone:

1. Press **Share summary** and paste the text into our chat. Label it with the run (W-iPhone, W-Android, S-iPhone, S-Android) and the phone's role.
2. If anything looked strange, also press **Share full log** and send the file. It contains no locations, routes or tokens.

Also tell me anything you noticed. For example: the blue location pill disappeared, the app had to restart, the walk ended early, or the watching phone showed the walker vanishing.

## Step 6: Close the room

Once the summaries are saved, run `supabase/spike/live_walk_spike_teardown.sql` in the SQL editor. Afterwards, `realtime.messages` should have no policies again.

## How the answers are used (decision rules)

| Result | Next step |
|---|---|
| The locked phone's connection and Presence survive standing still (Q2–Q3) | Presence carries "still here", and the Broadcast savings hold in the background too. |
| They don't | A locked walker who stands still disappears for the others about 2 minutes after the phone goes quiet, as the plan already allows. Savings come mostly from moving phones, and the load estimates are restated before the next phase. |
| Q5: the token doesn't renew while locked and the room drops | The publisher rejoins on unlock, and the database checkpoint covers the gap. This is documented as a limitation. |
| Q7 fails | Database changes stay on a separate, non-private channel. |
| Q8 shows any leak | **Stop.** Private rooms are not used until this is understood. |

Whatever the results, nothing in the design publishes from the background unless Q1 or Q6 shows something that actually runs there.
