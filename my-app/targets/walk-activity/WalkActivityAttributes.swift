//  WalkActivityAttributes.swift
//
//  The walk Live Activity's shape. THIS FILE EXISTS TWICE, BYTE FOR BYTE:
//
//    targets/walk-activity/WalkActivityAttributes.swift          (widget extension)
//    modules/pawtchi-live-activity/ios/WalkActivityAttributes.swift  (app module)
//
//  Do not edit one without the other. `liveActivityAttributes.test.ts` fails the
//  build if they diverge, because divergence is otherwise SILENT: ActivityKit
//  encodes ContentState in the app and decodes it in the widget process, so a
//  single renamed field produces a card that quietly stops updating rather than
//  a compiler error.
//
//  The duplication is deliberate, not laziness. The two targets are separate
//  binaries — the widget is an app extension, the app side is a CocoaPods pod —
//  and CocoaPods silently drops `source_files` entries that point outside the
//  podspec's own directory, so one file genuinely cannot serve both.
//
//  Everything immutable for the life of a walk lives in the attributes; only
//  what actually changes rides in ContentState, because that is what gets
//  re-encoded and pushed to the widget process on every update.
//
//  Every user-facing string arrives here ALREADY RESOLVED, from
//  lib/walk/liveCopy.ts. The widget authors no copy of its own.

import ActivityKit
import Foundation

@available(iOS 16.2, *)
public struct PawtchiWalkAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /// Uppercase label beside the live pulse: WALKING / SNIFFING / STARTING,
    /// or the wrap-up's "HOME · WALK SAVED".
    public var eyebrow: String
    /// The serif line: the dog's name, "Momo's walk", or "18 min together".
    public var title: String
    /// Sub-copy on the starting and finished cards. Empty while walking, where
    /// the timer owns that space.
    public var subtitle: String
    /// Frozen end time. `nil` while the walk is live, which is what tells the
    /// view to run a self-ticking timer instead of a fixed duration.
    public var endedAt: Date?
    public var distanceKm: Double
    /// Closed sniff episodes only — see lib/walk/liveActivity.ts.
    public var sniffCount: Int
    /// The geofence pill's label; empty when the pill should be dropped.
    public var endsAtHomeLabel: String
    /// Non-empty when GPS has gone quiet: replaces the stats shelf and freezes
    /// the head dot's breathing.
    public var signalLostLabel: String
    /// "starting" | "walking" | "sniffing" | "finished".
    public var state: String
    /// Flat [x, y, x, y, …] normalized to 0…1, y down.
    public var route: [Double]
    /// Current position in the same space; nil before the first accepted fix.
    public var head: [Double]?
    /// Flat [x, y, …] of closed sniff stops, same projection as `route`.
    public var sniffs: [Double]
    /// The wrap-up's CTA label; empty on every other state.
    public var ctaLabel: String
    /// Where the CTA goes. Empty until there is a saved walk to open.
    public var ctaUrl: String

    public init(
      eyebrow: String,
      title: String,
      subtitle: String,
      endedAt: Date? = nil,
      distanceKm: Double,
      sniffCount: Int,
      endsAtHomeLabel: String,
      signalLostLabel: String,
      state: String,
      route: [Double],
      head: [Double]?,
      sniffs: [Double],
      ctaLabel: String,
      ctaUrl: String
    ) {
      self.eyebrow = eyebrow
      self.title = title
      self.subtitle = subtitle
      self.endedAt = endedAt
      self.distanceKm = distanceKm
      self.sniffCount = sniffCount
      self.endsAtHomeLabel = endsAtHomeLabel
      self.signalLostLabel = signalLostLabel
      self.state = state
      self.route = route
      self.head = head
      self.sniffs = sniffs
      self.ctaLabel = ctaLabel
      self.ctaUrl = ctaUrl
    }
  }

  /// The walk session id — the activity's identity, so a stale card from a
  /// previous walk can never be mistaken for the current one.
  public var walkId: String
  public var petName: String
  public var startedAt: Date

  public init(walkId: String, petName: String, startedAt: Date) {
    self.walkId = walkId
    self.petName = petName
    self.startedAt = startedAt
  }
}
