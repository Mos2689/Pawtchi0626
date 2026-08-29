//  RouteTrace.swift
//
//  The walk drawing itself, and the live pulse that says it is still happening.
//
//  Every coordinate arriving here has already been fitted by `routeTransform`
//  in lib/walk/routeSvg.ts — the same transform the post-walk summary, the
//  share card and the Walk Story use. So this file does no fitting of its own:
//  it only stretches a 0…1 space across whatever rect it is given. That is what
//  makes a walk on the Lock Screen and the same walk in its keepsake one shape
//  rather than two that merely resemble each other.
//
//  The route is INK. The only yellow on this card is the live pulse and the
//  head of the trace — see the colour note in PawtchiTheme.

import SwiftUI

/// Turn a flat, normalized [x, y, x, y, …] array into points inside a rect.
func unitPoints(_ flat: [Double], in rect: CGRect) -> [CGPoint] {
  guard flat.count >= 2 else { return [] }
  var points: [CGPoint] = []
  points.reserveCapacity(flat.count / 2)
  var index = 0
  while index + 1 < flat.count {
    points.append(
      CGPoint(
        x: rect.minX + CGFloat(flat[index]) * rect.width,
        y: rect.minY + CGFloat(flat[index + 1]) * rect.height
      )
    )
    index += 2
  }
  return points
}

/// The route polyline. A single point is not a route — it draws nothing rather
/// than a dot, because the start marker already covers that case.
struct RouteTrace: Shape {
  let flat: [Double]

  func path(in rect: CGRect) -> Path {
    var path = Path()
    let points = unitPoints(flat, in: rect)
    guard points.count >= 2 else { return path }
    path.move(to: points[0])
    for point in points.dropFirst() { path.addLine(to: point) }
    return path
  }
}

/// The live pulse: a yellow dot inside a ring that expands and fades.
///
/// This is the card's only continuous motion besides the head's breathing, and
/// it is what distinguishes a live walk from a screenshot of one. Live
/// Activities restrict animation, so if the system declines to run it the dot
/// simply sits still — which still reads correctly.
struct LivePulse: View {
  var size: CGFloat = 18
  var dot: CGFloat = 10
  /// Ink ring on paper; on the Island's black ground the ring goes white.
  var ringColor: Color = PawtchiColor.inkTrace
  var animated: Bool = true

  @State private var expanded = false

  var body: some View {
    ZStack {
      Circle()
        .stroke(ringColor, lineWidth: 1.5)
        .frame(width: size, height: size)
        .scaleEffect(expanded ? 1.5 : 0.72)
        .opacity(expanded ? 0 : 1)
      Circle()
        .fill(PawtchiColor.live)
        .frame(width: dot, height: dot)
    }
    .frame(width: size, height: size)
    .onAppear {
      guard animated else { return }
      withAnimation(.easeOut(duration: 2.6).repeatForever(autoreverses: false)) {
        expanded = true
      }
    }
  }
}

/// The route canvas: the inked trace, its sniff stops, where the walk began,
/// and where the dog is now.
///
/// `compact` is the Dynamic Island's wide, short variant — same drawing, tighter
/// marks, no glow, because at that size a glow just reads as a smudge.
struct RouteCanvas: View {
  let route: [Double]
  let sniffs: [Double]
  let head: [Double]?
  /// Ink on paper; the Island inverts it to white.
  var lineColor: Color = PawtchiColor.ink
  var startColor: Color = PawtchiColor.inkTrace
  /// Frozen when GPS is lost — a breathing dot would imply a live position.
  var breathing: Bool = true
  var compact: Bool = false

  @State private var breathed = false

  private var lineWidth: CGFloat { compact ? 2.4 : 3.5 }
  private var headSize: CGFloat { compact ? 10 : 14 }

  var body: some View {
    GeometryReader { geometry in
      let rect = CGRect(origin: .zero, size: geometry.size)
      let points = unitPoints(route, in: rect)
      let stops = unitPoints(sniffs, in: rect)
      let headPoint = head.flatMap { unitPoints($0, in: rect).first }

      ZStack {
        RouteTrace(flat: route)
          .stroke(
            lineColor,
            style: StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round)
          )

        // Sniff stops: hollow ink rings, so the line stays readable through
        // them. The dog stopping to investigate is the thing Pawtchi notices
        // that a step counter does not — it earns a mark, not a highlight.
        if !compact {
          // Indexed rather than tuple-destructured: a ViewBuilder closure over
          // `enumerated()` is a single tuple parameter, and spelling it
          // `{ _, point in }` does not reliably type-check.
          ForEach(stops.indices, id: \.self) { index in
            Circle()
              .stroke(lineColor.opacity(0.45), lineWidth: 1.4)
              .frame(width: 7, height: 7)
              .position(stops[index])
          }
        }

        if let start = points.first {
          Circle()
            .fill(startColor)
            .frame(width: 7, height: 7)
            .position(start)
        }

        if let headPoint {
          Circle()
            .fill(PawtchiColor.live)
            .overlay(Circle().stroke(PawtchiColor.ink, lineWidth: 1.5))
            .frame(width: headSize, height: headSize)
            .scaleEffect(breathed ? 1.045 : 1.0)
            .position(headPoint)
        }
      }
    }
    .onAppear {
      guard breathing else { return }
      withAnimation(.easeInOut(duration: 4).repeatForever(autoreverses: true)) {
        breathed = true
      }
    }
  }
}

/// The starting card's record disc: a yellow ring with an ink core and the same
/// 2.6s ripple as the live pulse.
struct RecordDisc: View {
  var body: some View {
    ZStack {
      Circle().fill(PawtchiColor.live).frame(width: 32, height: 32)
      Circle().fill(PawtchiColor.ink).frame(width: 10, height: 10)
      LivePulse(size: 44, dot: 0, ringColor: PawtchiColor.ink.opacity(0.25))
    }
    .frame(width: 44, height: 44)
  }
}
