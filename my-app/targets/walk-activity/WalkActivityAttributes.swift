//  WalkActivityAttributes.swift
//
//  The ONE definition of the walk Live Activity's shape.
//
//  This file is compiled into BOTH targets: the widget extension (which owns
//  this folder) and the app's PawtchiLiveActivity module, whose podspec reaches
//  in here by relative path. There is deliberately no second copy — ActivityKit
//  encodes and decodes ContentState across a process boundary, so two
//  definitions that drift by a single field name produce a card that silently
//  stops updating rather than a build error.
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
