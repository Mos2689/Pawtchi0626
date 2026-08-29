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

import ActivityKit
import Foundation

@available(iOS 16.2, *)
public struct PawtchiWalkAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /// Frozen end time. `nil` while the walk is live, which is what tells the
    /// view to run a self-ticking timer instead of a fixed duration.
    public var endedAt: Date?
    public var distanceKm: Double
    /// Closed sniff episodes only — see lib/walk/liveActivity.ts.
    public var sniffCount: Int
    /// Resolved in TypeScript from WALK_STATUS_COPY and rendered verbatim, so
    /// no user-facing string is ever duplicated into Swift.
    public var statusLine: String
    /// "acquiring" | "walking" | "sniffing" | "finished".
    public var state: String
    /// Flat [x, y, x, y, …] normalized to 0…1, y down.
    public var route: [Double]
    /// Current position in the same space; nil before the first accepted fix.
    public var head: [Double]?
    /// Flat [x, y, …] of closed sniff stops, same projection as `route`.
    public var sniffs: [Double]

    public init(
      endedAt: Date? = nil,
      distanceKm: Double,
      sniffCount: Int,
      statusLine: String,
      state: String,
      route: [Double],
      head: [Double]?,
      sniffs: [Double]
    ) {
      self.endedAt = endedAt
      self.distanceKm = distanceKm
      self.sniffCount = sniffCount
      self.statusLine = statusLine
      self.state = state
      self.route = route
      self.head = head
      self.sniffs = sniffs
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
