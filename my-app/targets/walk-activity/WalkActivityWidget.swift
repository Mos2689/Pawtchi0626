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

  // Split for the shelf's value-and-label pairs. Not new copy: these are the
  // same two strings above, taken apart at the space that was already in them,
  // so the number can carry the weight and the unit can step back.
  var distanceValue: String { String(format: "%.2f", distanceKm) }
  var distanceUnit: String { "km" }
  var sniffValue: String { "\(sniffCount)" }
  var sniffUnit: String { sniffCount == 1 ? "sniff" : "sniffs" }
}

// The handoff's corner emblem is deliberately absent.
//
// It was drawn from assets/images/runningDog.svg, and that file is a raster
// trace: it carries a white background rect and trace noise, which the RN
// `RunningDogIcon` component strips at render time by cherry-picking five
// paths. An Xcode asset catalog does no such stripping, so the same file
// rendered on the Lock Screen as a solid black block.
//
// Rather than commit a second, cleaned copy of the art for one 22pt decoration,
// the mark is dropped — the handoff lists it as expendable when height is
// tight, and height IS tight here. The live pulse already brands the card.

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
///
/// 1.7 of tracking, matching the viewer's dateline eyebrow. At this size the
/// tracking IS the style — it is what separates a label from a small heading.
private struct Eyebrow: View {
  let text: String
  var color: Color = PawtchiColor.ink

  var body: some View {
    Text(text)
      .font(PawtchiFont.bold(9.5))
      .tracking(1.7)
      .foregroundColor(color)
      .lineLimit(1)
  }
}

/// One cell of the stats shelf — the viewer's divided stat row, at card scale.
///
/// Value and label are stacked there and set side by side here, for one reason:
/// iOS clips the Lock Screen presentation at roughly 160pt and this card already
/// measures ~153. A second line of type in the shelf is the whole remaining
/// budget. The pattern that survives the cut is the DIVIDER — hairline-separated
/// facts rather than dot-separated ones — which is what carries the family
/// resemblance to the viewer.
@available(iOS 16.2, *)
private struct StatCell: View {
  let value: String
  let label: String

  var body: some View {
    HStack(spacing: 4) {
      Text(value)
        .font(PawtchiFont.bold(12.5))
        .monospacedDigit()
        .foregroundColor(PawtchiColor.ink)
      Text(label)
        .font(PawtchiFont.medium(11.5))
        .foregroundColor(PawtchiColor.inkFaint)
    }
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
    .padding(.horizontal, 9)
    .padding(.vertical, 5)
    .background(Capsule().fill(PawtchiColor.pillFill))
  }
}

// MARK: - Lock Screen

@available(iOS 16.2, *)
struct WalkLockScreenView: View {
  let context: ActivityViewContext<PawtchiWalkAttributes>

  private var state: PawtchiWalkAttributes.ContentState { context.state }

  /// ── Sizing note ──
  ///
  /// iOS caps the Lock Screen presentation at roughly 160pt and CLIPS anything
  /// taller — it does not scale it down. The handoff's type ramp (26pt name,
  /// 54pt timer, 104×88 well, 16/18/15/18 padding) measures ~195pt and lost its
  /// whole stats shelf to that clip. Everything below is the same layout and
  /// hierarchy re-proportioned to ~153pt. The timer is still by far the largest
  /// element on the card, which is the part that mattered.
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
    .padding(.vertical, 12)
    .padding(.horizontal, 16)
    .frame(maxWidth: .infinity, alignment: .leading)
    // An OPAQUE fill. `activityBackgroundTint` alone only tints iOS's
    // translucent material, which let the Lock Screen wallpaper read straight
    // through the card. Both are set: the fill covers the content area, the
    // tint matches the system's own edges so they cannot disagree.
    .background(PawtchiColor.paper)
    .activityBackgroundTint(PawtchiColor.paper)
    .activitySystemActionForegroundColor(PawtchiColor.ink)
  }

  // ── Walking (and sniffing): the card this feature exists for ──
  private var walkingCard: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 7) {
        LivePulse(size: 16, dot: 9, animated: state.hasSignal)
        Eyebrow(text: state.eyebrow)
        Spacer(minLength: 0)
      }

      HStack(alignment: .bottom, spacing: 12) {
        VStack(alignment: .leading, spacing: 0) {
          Text(state.title)
            .font(PawtchiFont.title(20))
            .tracking(-0.4)
            .foregroundColor(PawtchiColor.ink)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
          ElapsedClock(
            startedAt: context.attributes.startedAt,
            endedAt: nil,
            font: PawtchiFont.extraLight(40)
          )
        }
        .frame(maxWidth: .infinity, alignment: .leading)

        // Only once there is a line to draw. An empty well is a grey box that
        // reads as a failed image, which is exactly how it looked in the first
        // seconds of a walk; without it the name and timer simply take the
        // full width until the route arrives.
        if state.hasRoute {
          routeWell
        }
      }

      statsShelf
    }
  }

  private var routeWell: some View {
    RoundedRectangle(cornerRadius: 14, style: .continuous)
      .fill(PawtchiColor.well)
      .frame(width: 96, height: 74)
      .overlay(
        RouteCanvas(
          route: state.route,
          sniffs: state.sniffs,
          head: state.head,
          breathing: state.hasSignal
        )
        .padding(9)
      )
  }

  /// The shelf, or the lost-signal line in its place. Never both: a distance
  /// shown beside "Waiting for signal" is a number the card cannot stand behind.
  private var statsShelf: some View {
    VStack(spacing: 0) {
      Rectangle()
        .fill(PawtchiColor.hairline)
        .frame(height: 1)

      Group {
        if state.hasSignal {
          HStack(spacing: 0) {
            StatCell(value: state.distanceValue, label: state.distanceUnit)
            // The hairline that replaced a dot. Same rule as the viewer's stat
            // row: facts are divided, not strung together — a separator dot
            // makes two measurements read as one phrase.
            Rectangle()
              .fill(PawtchiColor.hairline)
              .frame(width: 1, height: 13)
              .padding(.horizontal, 10)
            StatCell(value: state.sniffValue, label: state.sniffUnit)
            Spacer(minLength: 6)
            if !state.endsAtHomeLabel.isEmpty {
              GeofencePill(label: state.endsAtHomeLabel)
            }
          }
          .lineLimit(1)
        } else {
          HStack {
            Text(state.signalLostLabel)
              .font(PawtchiFont.medium(12))
              .foregroundColor(PawtchiColor.inkFaint)
              .lineLimit(1)
            Spacer(minLength: 0)
          }
        }
      }
      .padding(.top, 9)
    }
    .padding(.top, 2)
  }

  // ── Starting: a walk that exists but has no shape yet ──
  private var startingCard: some View {
    HStack(alignment: .center, spacing: 14) {
      VStack(alignment: .leading, spacing: 5) {
        Eyebrow(text: state.eyebrow, color: PawtchiColor.inkFaint)
        Text(state.title)
          .font(PawtchiFont.title(24))
          .tracking(-0.4)
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
          .font(PawtchiFont.title(24))
          .tracking(-0.4)
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
              .font(PawtchiFont.title(18))
              .tracking(-0.4)
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
