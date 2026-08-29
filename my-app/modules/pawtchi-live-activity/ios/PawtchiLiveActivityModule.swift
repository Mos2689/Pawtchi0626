//  PawtchiLiveActivityModule.swift
//
//  The app's entire ActivityKit surface for tracked walks.
//
//  ── What this module is allowed to do ──
//
//  Start, update and end ONE Live Activity that mirrors a walk. That is all. It
//  holds no walk state of its own, it reads no location, and nothing here can
//  start or stop the OS location task — the durable `walk:active` record in
//  lib/walk/walkTracker.ts remains the sole authority for whether a walk is
//  happening, exactly as it was before this feature existed.
//
//  ── Why every path swallows its errors ──
//
//  ActivityKit throws for reasons that have nothing to do with the walk: the
//  owner disabled Live Activities in Settings, the system budget is exhausted,
//  the activity was dismissed by hand. None of those are worth surfacing, and
//  none of them may ever propagate back into walk state. A walk that tracks
//  perfectly while its Lock Screen card is missing is a minor disappointment;
//  a walk that fails because a card could not be drawn is a bug of the exact
//  class this feature was designed not to introduce.

import ActivityKit
import ExpoModulesCore

/// The JS payload, mirroring `LiveWalkContent` in lib/walk/liveActivity.ts.
struct WalkContentRecord: Record {
  @Field var walkId: String = ""
  @Field var petName: String = ""
  /// Epoch milliseconds — JS has no Date across the bridge.
  @Field var startedAt: Double = 0
  @Field var endedAt: Double? = nil
  @Field var distanceKm: Double = 0
  @Field var sniffCount: Int = 0
  @Field var statusLine: String = ""
  @Field var state: String = "walking"
  @Field var route: [Double] = []
  @Field var head: [Double]? = nil
  @Field var sniffs: [Double] = []
  @Field var staleAfterMs: Double = 300_000
}

private func date(fromEpochMs milliseconds: Double) -> Date {
  Date(timeIntervalSince1970: milliseconds / 1000)
}

@available(iOS 16.2, *)
private func contentState(from record: WalkContentRecord) -> PawtchiWalkAttributes.ContentState {
  PawtchiWalkAttributes.ContentState(
    endedAt: record.endedAt.map { date(fromEpochMs: $0) },
    distanceKm: record.distanceKm,
    sniffCount: record.sniffCount,
    statusLine: record.statusLine,
    state: record.state,
    route: record.route,
    head: record.head,
    sniffs: record.sniffs
  )
}

public class PawtchiLiveActivityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PawtchiLiveActivity")

    /// True only when this device can actually show a card AND the owner has
    /// not switched Live Activities off for Pawtchi. JS uses this to skip the
    /// whole observer rather than push updates into a void.
    Function("isSupported") { () -> Bool in
      guard #available(iOS 16.2, *) else { return false }
      return ActivityAuthorizationInfo().areActivitiesEnabled
    }

    /// Begin the card. Called from the foreground on the user's own tap, which
    /// is the only context iOS 16 permits `Activity.request` in — and the only
    /// context a walk ever starts from.
    AsyncFunction("start") { (content: WalkContentRecord) -> Bool in
      guard #available(iOS 16.2, *),
            ActivityAuthorizationInfo().areActivitiesEnabled else { return false }

      // One walk, one card. A leftover from a previous walk is ended before a
      // new one begins, so two walks can never be on screen at once.
      await Self.endAll(dismiss: .immediate)

      do {
        _ = try Activity.request(
          attributes: PawtchiWalkAttributes(
            walkId: content.walkId,
            petName: content.petName,
            startedAt: date(fromEpochMs: content.startedAt)
          ),
          content: ActivityContent(
            state: contentState(from: content),
            staleDate: Date().addingTimeInterval(content.staleAfterMs / 1000)
          )
        )
        return true
      } catch {
        return false
      }
    }

    /// Push new numbers. Silently does nothing if there is no live card —
    /// re-requesting one from the background is not permitted on iOS 16, and
    /// guessing would be worse than a missing update.
    AsyncFunction("update") { (content: WalkContentRecord) -> Bool in
      guard #available(iOS 16.2, *) else { return false }
      guard let activity = Self.activity(for: content.walkId) else { return false }

      await activity.update(
        ActivityContent(
          state: contentState(from: content),
          staleDate: Date().addingTimeInterval(content.staleAfterMs / 1000)
        )
      )
      return true
    }

    /// The last frame: the walk's final numbers, left up briefly so a walk that
    /// auto-stopped in a pocket does not simply blink out of existence.
    AsyncFunction("end") { (content: WalkContentRecord, dismissAfterMs: Double) in
      guard #available(iOS 16.2, *) else { return }
      let policy: ActivityUIDismissalPolicy =
        dismissAfterMs <= 0
          ? .immediate
          : .after(Date().addingTimeInterval(dismissAfterMs / 1000))

      guard let activity = Self.activity(for: content.walkId) else {
        // The card is already gone (or belongs to another walk); make sure
        // nothing of ours is left behind regardless.
        await Self.endAll(dismiss: .immediate)
        return
      }

      await activity.end(
        ActivityContent(state: contentState(from: content), staleDate: nil),
        dismissalPolicy: policy
      )
    }

    /// The unconditional sweep. Called on launch whenever no walk record
    /// exists — the Live Activity's equivalent of walkTracker's "issue one stop
    /// to clear anything a previous build leaked".
    AsyncFunction("endAll") {
      guard #available(iOS 16.2, *) else { return }
      await Self.endAll(dismiss: .immediate)
    }
  }

  @available(iOS 16.2, *)
  private static func activity(for walkId: String) -> Activity<PawtchiWalkAttributes>? {
    Activity<PawtchiWalkAttributes>.activities.first { $0.attributes.walkId == walkId }
  }

  @available(iOS 16.2, *)
  private static func endAll(dismiss policy: ActivityUIDismissalPolicy) async {
    for activity in Activity<PawtchiWalkAttributes>.activities {
      // Spelled out rather than a bare `nil`: `end(_:dismissalPolicy:)` is
      // generic over ContentState, and a bare nil there gives the unhelpful
      // "'nil' requires a contextual type".
      let noFinalContent: ActivityContent<PawtchiWalkAttributes.ContentState>? = nil
      await activity.end(noFinalContent, dismissalPolicy: policy)
    }
  }
}
