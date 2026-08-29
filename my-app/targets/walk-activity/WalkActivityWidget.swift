//  WalkActivityWidget.swift
//
//  The Lock Screen card and Dynamic Island for a tracked walk.
//
//  Three rules govern everything here:
//
//  1. The elapsed clock is free. `Text(timerInterval:)` ticks in the widget
//     process from a Date the app set once, so the timer stays live even when
//     Pawtchi has not pushed an update for half a minute. Nothing else on this
//     card is allowed to depend on "now".
//
//  2. No copy is authored in Swift. Every string arrives resolved from
//     lib/walk/liveCopy.ts. The only text below is a unit suffix.
//
//  3. Colour discipline. Paper ground, ink type, ink route; yellow on the live
//     pulse and the route head and nowhere else; blue on the wrap-up only.

import ActivityKit
import SwiftUI
// `UIImage` in the asset-availability check below is a UIKit type.
import UIKit
import WidgetKit

@available(iOS 16.2, *)
private extension PawtchiWalkAttributes.ContentState {
  var isStarting: Bool { state == "starting" }
  var isFinished: Bool { state == "finished" }
  var hasSignal: Bool { signalLostLabel.isEmpty }
  var hasRoute: Bool { route.count >= 4 }

  var distanceText: String { String(format: "%.2f km", distanceKm) }
  var sniffText: String { "\(sniffCount) sniff\(sniffCount == 1 ? "" : "s")" }
  var islandDistanceText: String { String(format: "%.1f km", distanceKm) }
}

/// The Pawtchi mark. Falls back to a system glyph if the asset failed to compile
/// into the extension, rather than rendering an empty box.
private struct PawtchiEmblem: View {
  var size: CGFloat = 22

  var body: some View {
    Group {
      if UIImage(named: "RunningDog") != nil {
        Image("RunningDog").renderable(size: size)
      } else {
        Image(systemName: "figure.walk").renderable(size: size)
      }
    }
    .foregroundColor(PawtchiColor.ink)
    .opacity(0.9)
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
  var color: Color = PawtchiColor.ink

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
    .tracking(-1)
    .foregroundColor(color)
    .lineLimit(1)
    .minimumScaleFactor(0.7)
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

/// The uppercase label beside the live pulse.
private struct Eyebrow: View {
  let text: String
  var color: Color = PawtchiColor.ink

  var body: some View {
    Text(text)
      .font(PawtchiFont.bold(9.5))
      .tracking(1.5)
      .foregroundColor(color)
      .lineLimit(1)
  }
}

/// The "Ends at home" geofence pill. First thing dropped when height is tight.
private struct GeofencePill: View {
  let label: String

  var body: some View {
    HStack(spacing: 5) {
      Image(systemName: "house")
        .font(.system(size: 9, weight: .bold))
        .foregroundColor(PawtchiColor.ink)
      Text(label)
        .font(PawtchiFont.semibold(10.5))
        .foregroundColor(PawtchiColor.inkMuted)
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 6)
    .background(Capsule().fill(PawtchiColor.pillFill))
  }
}

// MARK: - Lock Screen

@available(iOS 16.2, *)
struct WalkLockScreenView: View {
  let context: ActivityViewContext<PawtchiWalkAttributes>

  private var state: PawtchiWalkAttributes.ContentState { context.state }

  var body: some View {
    Group {
      if state.isStarting {
        startingCard
      } else if state.isFinished {
        finishedCard
      } else {
        walkingCard
      }
    }
    .padding(.top, 16)
    .padding(.horizontal, 18)
    .padding(.bottom, 15)
    .activityBackgroundTint(state.isFinished ? PawtchiColor.cardFinished : PawtchiColor.paper)
    .activitySystemActionForegroundColor(PawtchiColor.ink)
  }

  // ── Walking (and sniffing): the card this feature exists for ──
  private var walkingCard: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        HStack(spacing: 7) {
          LivePulse(animated: state.hasSignal)
          Eyebrow(text: state.eyebrow)
        }
        Spacer(minLength: 8)
        PawtchiEmblem()
      }

      HStack(alignment: .bottom, spacing: 14) {
        VStack(alignment: .leading, spacing: 0) {
          Text(state.title)
            .font(PawtchiFont.serif(26))
            .foregroundColor(PawtchiColor.ink)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
          ElapsedClock(
            startedAt: context.attributes.startedAt,
            endedAt: nil,
            font: PawtchiFont.extraLight(54)
          )
          .padding(.top, 8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)

        routeWell
      }
      .padding(.top, 10)

      statsShelf
    }
  }

  /// Before the first accepted fix there is genuinely nothing to draw, and the
  /// starting card is shown instead — so by the time this appears there is
  /// always a trace. The empty branch only guards a walk that lost its fixes.
  private var routeWell: some View {
    RoundedRectangle(cornerRadius: 16, style: .continuous)
      .fill(PawtchiColor.well)
      .frame(width: 104, height: 88)
      .overlay(
        Group {
          if state.hasRoute {
            RouteCanvas(
              route: state.route,
              sniffs: state.sniffs,
              head: state.head,
              breathing: state.hasSignal
            )
            .padding(10)
          }
        }
      )
  }

  /// The shelf, or the lost-signal line in its place. Never both: a distance
  /// shown beside "Waiting for signal" is a number the card cannot stand behind.
  private var statsShelf: some View {
    VStack(spacing: 0) {
      Rectangle()
        .fill(PawtchiColor.hairline)
        .frame(height: 1)
        .padding(.top, 14)

      Group {
        if state.hasSignal {
          HStack(spacing: 8) {
            Text(state.distanceText)
              .font(PawtchiFont.bold(13))
              .monospacedDigit()
              .foregroundColor(PawtchiColor.ink)
            Circle()
              .fill(PawtchiColor.inkTrace)
              .frame(width: 3, height: 3)
            Text(state.sniffText)
              .font(PawtchiFont.bold(13))
              .foregroundColor(PawtchiColor.ink)
            Spacer(minLength: 8)
            if !state.endsAtHomeLabel.isEmpty {
              GeofencePill(label: state.endsAtHomeLabel)
            }
          }
        } else {
          HStack {
            Text(state.signalLostLabel)
              .font(PawtchiFont.medium(12))
              .foregroundColor(PawtchiColor.inkFaint)
            Spacer(minLength: 0)
          }
        }
      }
      .padding(.top, 13)
    }
  }

  // ── Starting: a walk that exists but has no shape yet ──
  private var startingCard: some View {
    HStack(alignment: .center, spacing: 14) {
      VStack(alignment: .leading, spacing: 5) {
        Eyebrow(text: state.eyebrow, color: PawtchiColor.inkFaint)
        Text(state.title)
          .font(PawtchiFont.serif(24))
          .foregroundColor(PawtchiColor.ink)
          .lineLimit(1)
          .minimumScaleFactor(0.7)
        Text(state.subtitle)
          .font(PawtchiFont.medium(12))
          .foregroundColor(PawtchiColor.inkMuted)
          .lineLimit(2)
          .fixedSize(horizontal: false, vertical: true)
      }
      Spacer(minLength: 8)
      RecordDisc()
    }
  }

  // ── Finished: the wrap-up reads as a memory, not an alert ──
  private var finishedCard: some View {
    HStack(alignment: .center, spacing: 14) {
      VStack(alignment: .leading, spacing: 5) {
        Eyebrow(text: state.eyebrow, color: PawtchiColor.discovery)
        Text(state.title)
          .font(PawtchiFont.serif(24))
          .foregroundColor(PawtchiColor.ink)
          .lineLimit(1)
          .minimumScaleFactor(0.7)
        Text(state.subtitle)
          .font(PawtchiFont.medium(12))
          .monospacedDigit()
          .foregroundColor(PawtchiColor.inkMuted)
          .lineLimit(1)
      }
      Spacer(minLength: 8)
      // Only offered once the walk actually reached the server — liveActivity.ts
      // leaves the label empty otherwise, rather than opening an empty screen.
      if !state.ctaLabel.isEmpty {
        Text(state.ctaLabel)
          .font(PawtchiFont.bold(11))
          .foregroundColor(PawtchiColor.ink)
          .padding(.horizontal, 12)
          .padding(.vertical, 8)
          .background(Capsule().fill(PawtchiColor.live))
      }
    }
  }
}

// MARK: - Widget

@available(iOS 16.2, *)
struct WalkActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: PawtchiWalkAttributes.self) { context in
      WalkLockScreenView(context: context)
        .widgetURL(Self.destination(for: context.state))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
              LivePulse(
                size: 14,
                dot: 8,
                ringColor: PawtchiColor.islandDivider,
                animated: context.state.hasSignal
              )
              Eyebrow(text: context.state.eyebrow, color: PawtchiColor.islandInk)
            }
            ElapsedClock(
              startedAt: context.attributes.startedAt,
              endedAt: context.state.endedAt,
              font: PawtchiFont.extraLight(34),
              color: PawtchiColor.islandInk
            )
          }
        }

        DynamicIslandExpandedRegion(.trailing) {
          VStack(alignment: .trailing, spacing: 2) {
            Text(context.state.title)
              .font(PawtchiFont.serif(18))
              .foregroundColor(PawtchiColor.islandInk)
              .lineLimit(1)
            Text("\(context.state.distanceText) · \(context.state.sniffText)")
              .font(PawtchiFont.medium(11))
              .foregroundColor(PawtchiColor.islandInkSoft)
              .lineLimit(1)
          }
        }

        DynamicIslandExpandedRegion(.bottom) {
          // The route inverts to white here: the Island is system-black, and
          // ink on black is invisible.
          if context.state.hasRoute {
            RouteCanvas(
              route: context.state.route,
              sniffs: context.state.sniffs,
              head: context.state.head,
              lineColor: PawtchiColor.islandInk,
              startColor: PawtchiColor.islandInkSoft,
              breathing: context.state.hasSignal,
              compact: true
            )
            .frame(height: 34)
            .padding(.top, 2)
          }
        }
      } compactLeading: {
        LivePulse(
          size: 14,
          dot: 8,
          ringColor: PawtchiColor.islandDivider,
          animated: context.state.hasSignal
        )
      } compactTrailing: {
        HStack(spacing: 5) {
          ElapsedClock(
            startedAt: context.attributes.startedAt,
            endedAt: context.state.endedAt,
            font: PawtchiFont.bold(14),
            color: PawtchiColor.islandInk
          )
          Rectangle()
            .fill(PawtchiColor.islandDivider)
            .frame(width: 1, height: 11)
          Text(context.state.islandDistanceText)
            .font(PawtchiFont.medium(12))
            .monospacedDigit()
            .foregroundColor(PawtchiColor.islandInkSoft)
        }
      } minimal: {
        Circle()
          .fill(PawtchiColor.live)
          .frame(width: 12, height: 12)
      }
      .widgetURL(Self.destination(for: context.state))
      .keylineTint(PawtchiColor.live)
    }
  }

  /// The live card opens the walk in progress; the wrap-up opens that walk's
  /// saved map. Both URLs are resolved in TypeScript.
  private static func destination(for state: PawtchiWalkAttributes.ContentState) -> URL? {
    if !state.ctaUrl.isEmpty { return URL(string: state.ctaUrl) }
    return URL(string: "pawtchi://walk")
  }
}

/// The `if #available` is Apple's documented pattern and is kept even though
/// expo-target.config.js sets this target's deployment target to 16.2. Marking
/// the `@main` type itself `@available` is the fragile version: if that
/// deployment target ever fails to apply, it becomes "'main' is only available
/// in iOS 16.2 or newer" — a confusing failure a long way from its cause.
@main
struct WalkActivityBundle: WidgetBundle {
  var body: some Widget {
    if #available(iOS 16.2, *) {
      WalkActivityWidget()
    }
  }
}
