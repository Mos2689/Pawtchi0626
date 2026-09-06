//  PawtchiTheme.swift
//
//  The widget extension's mirror of constants/design.ts.
//
//  A widget extension cannot import TypeScript, so this is the one sanctioned
//  duplication in the feature. Every value below has a named counterpart in
//  `color.liveActivity` / `font` — if the two ever disagree, design.ts wins.
//
//  ── Colour discipline (load-bearing) ──
//  Paper ground, ink type, ink route. `live` yellow appears on the pulse and the
//  head of the route AND NOWHERE ELSE — that restraint is the entire reason a
//  glance reads as "this is happening right now". `discovery` blue marks the
//  wrap-up only. Adding a third accent anywhere here breaks the design.

import SwiftUI
// Explicit, because `UIFont` below is a UIKit type and SwiftUI does not
// reliably re-export UIKit into an app-extension target.
import UIKit

/// Mirrors `color.liveActivity` in constants/design.ts.
enum PawtchiColor {
  /// Painted as an opaque `.background()` fill, never via
  /// `activityBackgroundTint` alone — that only tints iOS's translucent
  /// material and lets the wallpaper through.
  static let paper = Color.white
  static let well = hex(0xEAE7E0)
  static let ink = hex(0x101014)
  static let inkMuted = Color.black.opacity(0.55)
  static let inkFaint = Color.black.opacity(0.42)
  static let inkTrace = Color.black.opacity(0.28)
  static let hairline = Color.black.opacity(0.10)
  static let border = Color.black.opacity(0.08)
  static let pillFill = Color.black.opacity(0.06)
  static let live = hex(0xF4F600)
  static let discovery = hex(0x144EFF)
  static let cardFinished = Color.white

  // The Dynamic Island is system-black; paper never applies inside it.
  static let islandInk = Color.white
  static let islandInkSoft = Color.white.opacity(0.62)
  static let islandDivider = Color.white.opacity(0.22)

  private static func hex(_ value: UInt32) -> Color {
    Color(
      red: Double((value >> 16) & 0xFF) / 255,
      green: Double((value >> 8) & 0xFF) / 255,
      blue: Double(value & 0xFF) / 255
    )
  }
}

/// Mirrors the `font.memory*` tokens in constants/design.ts.
///
/// Plus Jakarta Sans, which is what the design handoff asked for. The first
/// build could not use it: adding a family for one surface is what the
/// design-system rule forbids, so Playfair carried the name and Montserrat the
/// UI, with ExtraLight standing in for Jakarta 200 on the timer.
///
/// That changed when the Walk Memory viewer adopted Jakarta (Sep 2026). The card
/// and the screen it belongs to are now set in one face, which is the point of
/// the handoff and the reason this file exists: a walk should look like the same
/// product on the Lock Screen as it does in the app.
///
/// Each face degrades to a weight-matched system font rather than to San
/// Francisco Regular: an unstyled card reads as broken, not as neutral. Google
/// ships PostScript names like "PlusJakartaSans-Bold" while the
/// @expo-google-fonts filenames use "PlusJakartaSans_700Bold", so both
/// spellings are tried.
enum PawtchiFont {
  /// Dog name and wrap-up title. `font.memoryBold`, as on the viewer's headline.
  static func title(_ size: CGFloat) -> Font {
    resolve(["PlusJakartaSans-Bold", "PlusJakartaSans_700Bold"], size, .bold, .default)
  }

  /// The big timer. Handoff asks for a 200 weight at 54pt.
  static func extraLight(_ size: CGFloat) -> Font {
    resolve(["PlusJakartaSans-ExtraLight", "PlusJakartaSans_200ExtraLight"], size, .thin, .default)
  }

  static func medium(_ size: CGFloat) -> Font {
    resolve(["PlusJakartaSans-Medium", "PlusJakartaSans_500Medium"], size, .medium, .default)
  }

  static func semibold(_ size: CGFloat) -> Font {
    resolve(["PlusJakartaSans-SemiBold", "PlusJakartaSans_600SemiBold"], size, .semibold, .default)
  }

  static func bold(_ size: CGFloat) -> Font {
    resolve(["PlusJakartaSans-Bold", "PlusJakartaSans_700Bold"], size, .bold, .default)
  }

  private static func resolve(
    _ names: [String],
    _ size: CGFloat,
    _ weight: Font.Weight,
    _ design: Font.Design
  ) -> Font {
    for name in names where UIFont(name: name, size: size) != nil {
      return .custom(name, size: size)
    }
    return .system(size: size, weight: weight, design: design)
  }
}
