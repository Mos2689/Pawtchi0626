//  WalkActivityPreviews.swift
//
//  One Xcode preview per state, so the card can be reviewed without a walk.
//
//  The sample route below is a hand-written loop in the SAME normalized 0…1
//  space that lib/walk/liveActivity.ts produces, so what renders here is
//  geometrically what a real walk renders. It is preview data only — the
//  shipping card never draws a placeholder path.

#if DEBUG
import ActivityKit
import SwiftUI
import WidgetKit

@available(iOS 16.2, *)
private enum WalkPreviewData {
  static let attributes = PawtchiWalkAttributes(
    walkId: "preview-walk",
    petName: "Momo",
    startedAt: Date().addingTimeInterval(-724)
  )

  /// A meandering out-and-back, flat [x, y, …], y down.
  static let route: [Double] = [
    0.08, 0.92, 0.11, 0.78, 0.09, 0.64, 0.16, 0.55, 0.14, 0.42, 0.22, 0.33,
    0.31, 0.28, 0.42, 0.26, 0.53, 0.22, 0.62, 0.14, 0.73, 0.10, 0.84, 0.12,
    0.90, 0.20, 0.86, 0.32, 0.78, 0.38, 0.70, 0.47, 0.66, 0.58, 0.72, 0.68,
  ]

  static let sniffs: [Double] = [0.14, 0.42, 0.62, 0.14, 0.86, 0.32]
  static let head: [Double] = [0.72, 0.68]

  static let starting = PawtchiWalkAttributes.ContentState(
    eyebrow: "STARTING",
    title: "Momo's walk",
    subtitle: "Finding GPS — hold on a moment",
    distanceKm: 0,
    sniffCount: 0,
    endsAtHomeLabel: "",
    signalLostLabel: "",
    state: "starting",
    route: [],
    head: nil,
    sniffs: [],
    ctaLabel: "",
    ctaUrl: ""
  )

  static let walking = PawtchiWalkAttributes.ContentState(
    eyebrow: "WALKING",
    title: "Momo",
    subtitle: "",
    distanceKm: 0.94,
    sniffCount: 4,
    endsAtHomeLabel: "Ends at home",
    signalLostLabel: "",
    state: "walking",
    route: route,
    head: head,
    sniffs: sniffs,
    ctaLabel: "",
    ctaUrl: ""
  )

  static let sniffing = PawtchiWalkAttributes.ContentState(
    eyebrow: "SNIFFING",
    title: "Momo",
    subtitle: "",
    distanceKm: 0.94,
    sniffCount: 5,
    endsAtHomeLabel: "Ends at home",
    signalLostLabel: "",
    state: "sniffing",
    route: route,
    head: head,
    sniffs: sniffs,
    ctaLabel: "",
    ctaUrl: ""
  )

  /// GPS dropped: the shelf gives way to the notice and the head stops breathing.
  static let signalLost = PawtchiWalkAttributes.ContentState(
    eyebrow: "WALKING",
    title: "Momo",
    subtitle: "",
    distanceKm: 0.94,
    sniffCount: 4,
    endsAtHomeLabel: "Ends at home",
    signalLostLabel: "Waiting for signal",
    state: "walking",
    route: route,
    head: head,
    sniffs: sniffs,
    ctaLabel: "",
    ctaUrl: ""
  )

  static let finished = PawtchiWalkAttributes.ContentState(
    eyebrow: "HOME · WALK SAVED",
    title: "18 min together",
    subtitle: "1.4 km · 6 sniffs",
    endedAt: Date(),
    distanceKm: 1.4,
    sniffCount: 6,
    endsAtHomeLabel: "",
    signalLostLabel: "",
    state: "finished",
    route: route,
    head: head,
    sniffs: sniffs,
    ctaLabel: "See the map",
    ctaUrl: "pawtchi://walk-story?id=preview-walk"
  )

  /// Finished with no signal — the honest variant, and no map link.
  static let finishedOffline = PawtchiWalkAttributes.ContentState(
    eyebrow: "HOME · WALK FINISHED",
    title: "18 min together",
    subtitle: "1.4 km · 6 sniffs",
    endedAt: Date(),
    distanceKm: 1.4,
    sniffCount: 6,
    endsAtHomeLabel: "",
    signalLostLabel: "",
    state: "finished",
    route: route,
    head: head,
    sniffs: sniffs,
    ctaLabel: "",
    ctaUrl: ""
  )
}

@available(iOS 17.0, *)
#Preview("Lock Screen · states", as: .content, using: WalkPreviewData.attributes) {
  WalkActivityWidget()
} contentStates: {
  WalkPreviewData.starting
  WalkPreviewData.walking
  WalkPreviewData.sniffing
  WalkPreviewData.signalLost
  WalkPreviewData.finished
  WalkPreviewData.finishedOffline
}

@available(iOS 17.0, *)
#Preview("Island · expanded", as: .dynamicIsland(.expanded), using: WalkPreviewData.attributes) {
  WalkActivityWidget()
} contentStates: {
  WalkPreviewData.walking
  WalkPreviewData.sniffing
  WalkPreviewData.finished
}

@available(iOS 17.0, *)
#Preview("Island · compact", as: .dynamicIsland(.compact), using: WalkPreviewData.attributes) {
  WalkActivityWidget()
} contentStates: {
  WalkPreviewData.walking
  WalkPreviewData.signalLost
}

@available(iOS 17.0, *)
#Preview("Island · minimal", as: .dynamicIsland(.minimal), using: WalkPreviewData.attributes) {
  WalkActivityWidget()
} contentStates: {
  WalkPreviewData.walking
}
#endif
