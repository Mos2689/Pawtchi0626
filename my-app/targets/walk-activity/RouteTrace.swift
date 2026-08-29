//  RouteTrace.swift
//
//  The walk drawing itself on the Lock Screen.
//
//  Every coordinate arriving here has already been fitted by `routeTransform`
//  in lib/walk/routeSvg.ts — the same transform the post-walk summary, the
//  share card and the Walk Story use. So this file does no fitting of its own:
//  it only stretches a 0…1 space across whatever rect it is given. That is what
//  makes a walk on the Lock Screen and the same walk in its keepsake one shape
//  rather than two that merely resemble each other.

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

/// The route canvas: the trace, its sniff stops, where the walk began, and
/// where the dog is now.
///
/// `compact` is the Dynamic Island's wide, short variant — same drawing, tighter
/// marks, no halo, because at that size a halo just reads as a smudge.
struct RouteCanvas: View {
  let route: [Double]
  let sniffs: [Double]
  let head: [Double]?
  var compact: Bool = false

  private var lineWidth: CGFloat { compact ? 2.2 : 2.6 }
  private var startRadius: CGFloat { compact ? 2.8 : 3.4 }
  private var headRadius: CGFloat { compact ? 4.0 : 4.4 }

  var body: some View {
    GeometryReader { geometry in
      let rect = CGRect(origin: .zero, size: geometry.size)
      let start = unitPoints(route, in: rect).first
      let headPoint = head.flatMap { unitPoints($0, in: rect).first }

      ZStack {
        RouteTrace(flat: route)
          .stroke(
            PawtchiColor.yellow,
            style: StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round)
          )

        // Sniff stops: hollow rings, so the line stays readable through them.
        // The dog stopping to investigate is the thing Pawtchi notices that a
        // step counter does not — it earns a mark, not a highlight.
        if !compact {
          ForEach(Array(unitPoints(sniffs, in: rect).enumerated()), id: \.offset) { _, point in
            Circle()
              .stroke(PawtchiColor.yellow.opacity(0.6), lineWidth: 1.4)
              .frame(width: 8, height: 8)
              .position(point)
          }
        }

        if let start {
          Circle()
            .fill(PawtchiColor.cream)
            .frame(width: startRadius * 2, height: startRadius * 2)
            .position(start)
        }

        if let headPoint {
          ZStack {
            if !compact {
              Circle()
                .fill(PawtchiColor.yellow.opacity(0.22))
                .frame(width: 16, height: 16)
            }
            Circle()
              .fill(PawtchiColor.yellow)
              .frame(width: headRadius * 2, height: headRadius * 2)
          }
          .position(headPoint)
        }
      }
    }
  }
}
