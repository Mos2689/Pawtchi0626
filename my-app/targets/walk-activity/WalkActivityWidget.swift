//  WalkActivityWidget.swift
//
//  The Lock Screen card and Dynamic Island for a walk in progress.
//
//  Two rules govern everything here:
//
//  1. The elapsed clock is free. `Text(timerInterval:)` ticks in the widget
//     process from a Date the app set once, so the timer stays live even when
//     Pawtchi has not pushed an update in a minute. Nothing else on this card
//     is allowed to depend on "now".
//
//  2. No copy is authored in Swift. `statusLine` arrives already resolved from
//     lib/walk/liveCopy.ts. The only strings below are unit suffixes and a
//     pluralised "sniff", which are formatting, not voice.

import ActivityKit
import SwiftUI
import WidgetKit

@available(iOS 16.2, *)
private extension PawtchiWalkAttributes.ContentState {
  var isFinished: Bool { state == "finished" }
  var isSniffing: Bool { state == "sniffing" }

  var distanceText: String { String(format: "%.2f km", distanceKm) }
  var sniffText: String { "\(sniffCount) sniff\(sniffCount == 1 ? "" : "s")" }
  var hasRoute: Bool { route.count >= 4 }
}

/// The running dog, tinted. Falls back to a system glyph if the asset failed to
/// compile into the extension rather than rendering an empty box.
private struct RunningDog: View {
  var size: CGFloat = 17

  var body: some View {
    Group {
      if UIImage(named: "RunningDog") != nil {
        Image("RunningDog").renderable(size: size)
      } else {
        Image(systemName: "figure.walk").renderable(size: size)
      }
    }
    .foregroundColor(PawtchiColor.yellow)
  }
}

private extension Image {
  func renderable(size: CGFloat) -> some View {
    self.renderingMode(.template)
      .resizable()
      .aspectRatio(contentMode: .fit)
      .frame(width: size, height: size)
  }
}

/// The self-ticking elapsed clock, or a frozen duration once the walk is over.
@available(iOS 16.2, *)
private struct ElapsedClock: View {
  let startedAt: Date
  let endedAt: Date?
  let font: Font
  var color: Color = PawtchiColor.cream

  var body: some View {
    Group {
      if let endedAt {
        Text(Self.formatted(endedAt.timeIntervalSince(startedAt)))
      } else {
        Text(timerInterval: startedAt...Date.distantFuture, countsDown: false)
      }
    }
    .font(font)
    .monospacedDigit()
    .foregroundColor(color)
  }

  private static func formatted(_ seconds: TimeInterval) -> String {
    let total = Int(max(0, seconds))
    let hours = total / 3600
    let minutes = (total % 3600) / 60
    let secs = total % 60
    return hours > 0
      ? String(format: "%d:%02d:%02d", hours, minutes, secs)
      : String(format: "%02d:%02d", minutes, secs)
  }
}

// MARK: - Lock Screen

@available(iOS 16.2, *)
struct WalkLockScreenView: View {
  let context: ActivityViewContext<PawtchiWalkAttributes>

  private var state: PawtchiWalkAttributes.ContentState { context.state }

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      VStack(alignment: .leading, spacing: 0) {
        Text("TRACKED WALK")
          .font(PawtchiFont.semibold(9))
          .tracking(1.3)
          .foregroundColor(PawtchiColor.creamFaint)

        Text(context.attributes.petName)
          .font(PawtchiFont.bold(17))
          .foregroundColor(PawtchiColor.cream)
          .lineLimit(1)
          .padding(.top, 3)

        Text(state.statusLine)
          .font(PawtchiFont.medium(11.5))
          .foregroundColor(PawtchiColor.creamDim)
          .lineLimit(2)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.top, 2)

        Spacer(minLength: 6)

        ElapsedClock(
          startedAt: context.attributes.startedAt,
          endedAt: state.endedAt,
          font: PawtchiFont.bold(30)
        )

        HStack(spacing: 7) {
          Text(state.distanceText)
          Text("·").foregroundColor(PawtchiColor.cream.opacity(0.3))
          Text(state.sniffText)
        }
        .font(PawtchiFont.semibold(12))
        .foregroundColor(PawtchiColor.cream.opacity(0.82))
        .padding(.top, 7)
      }
      .frame(maxWidth: .infinity, alignment: .leading)

      routeCanvas
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 14)
    .activityBackgroundTint(PawtchiColor.navy)
    .activitySystemActionForegroundColor(PawtchiColor.cream)
  }

  /// Before the first accepted fix there is genuinely nothing to draw. An empty
  /// well is the honest answer — a spinner would imply Pawtchi is working on
  /// something, and a placeholder route would be a small lie about the walk.
  private var routeCanvas: some View {
    RoundedRectangle(cornerRadius: 14, style: .continuous)
      .fill(PawtchiColor.navyRaised)
      .frame(width: 112, height: 122)
      .overlay(
        Group {
          if state.hasRoute {
            RouteCanvas(route: state.route, sniffs: state.sniffs, head: state.head)
              .padding(6)
          }
        }
      )
  }
}

// MARK: - Widget

@available(iOS 16.2, *)
struct WalkActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: PawtchiWalkAttributes.self) { context in
      WalkLockScreenView(context: context)
        .widgetURL(URL(string: "pawtchi://walk"))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          VStack(alignment: .leading, spacing: 1) {
            Text(context.attributes.petName)
              .font(PawtchiFont.bold(14))
              .foregroundColor(PawtchiColor.cream)
              .lineLimit(1)
            Text(context.state.statusLine)
              .font(PawtchiFont.medium(11))
              .foregroundColor(PawtchiColor.cream.opacity(0.6))
              .lineLimit(1)
          }
        }

        DynamicIslandExpandedRegion(.trailing) {
          VStack(alignment: .trailing, spacing: 1) {
            Text(context.state.distanceText)
              .font(PawtchiFont.bold(14))
              .foregroundColor(PawtchiColor.cream)
            Text(context.state.sniffText)
              .font(PawtchiFont.medium(11))
              .foregroundColor(PawtchiColor.cream.opacity(0.6))
          }
        }

        DynamicIslandExpandedRegion(.bottom) {
          if context.state.hasRoute {
            RouteCanvas(
              route: context.state.route,
              sniffs: context.state.sniffs,
              head: context.state.head,
              compact: true
            )
            .frame(height: 34)
            .padding(.top, 2)
          } else {
            ElapsedClock(
              startedAt: context.attributes.startedAt,
              endedAt: context.state.endedAt,
              font: PawtchiFont.bold(20)
            )
          }
        }
      } compactLeading: {
        RunningDog(size: 15)
      } compactTrailing: {
        ElapsedClock(
          startedAt: context.attributes.startedAt,
          endedAt: context.state.endedAt,
          font: PawtchiFont.semibold(13),
          color: PawtchiColor.yellow
        )
      } minimal: {
        RunningDog(size: 14)
      }
      .widgetURL(URL(string: "pawtchi://walk"))
      .keylineTint(PawtchiColor.yellow)
    }
  }
}

/// The extension's deployment target is 16.2 (see expo-target.config.js), so
/// no availability branch is needed here — the whole bundle is 16.2+ by
/// construction. The `@available` annotations above are belt-and-braces in case
/// that target is ever lowered.
@available(iOS 16.2, *)
@main
struct WalkActivityBundle: WidgetBundle {
  var body: some Widget {
    WalkActivityWidget()
  }
}
