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

/// Mirrors the `font` tokens in constants/design.ts.
///
/// The design handoff specifies Instrument Serif and Plus Jakarta Sans. Neither
/// exists in this app, and shipping two families that appear on no other screen
/// is exactly what the design-system rule forbids — so the app's own faces stand
/// in: Playfair Display for the serif (the sanctioned editorial face, see the
/// fence comment on `font.memoryTitle`) and Montserrat for UI, with ExtraLight
/// carrying the large timer where the handoff asks for Jakarta 200.
///
/// Each face degrades to a weight-matched system font rather than to San
/// Francisco Regular: an unstyled card reads as broken, not as neutral. Google
/// ships PostScript names like "Montserrat-Bold" while the @expo-google-fonts
/// filenames use "Montserrat_700Bold", so both spellings are tried.
enum PawtchiFont {
  /// Dog name and wrap-up title. `font.memoryTitle`.
  static func serif(_ size: CGFloat) -> Font {
    resolve(["PlayfairDisplay-Medium", "PlayfairDisplay_500Medium"], size, .regular, .serif)
  }

  /// The big timer. Handoff asks for a 200 weight at 54pt.
  static func extraLight(_ size: CGFloat) -> Font {
    resolve(["Montserrat-ExtraLight", "Montserrat_200ExtraLight"], size, .thin, .default)
  }

  static func medium(_ size: CGFloat) -> Font {
    resolve(["Montserrat-Medium", "Montserrat_500Medium"], size, .medium, .default)
  }

  static func semibold(_ size: CGFloat) -> Font {
    resolve(["Montserrat-SemiBold", "Montserrat_600SemiBold"], size, .semibold, .default)
  }

  static func bold(_ size: CGFloat) -> Font {
    resolve(["Montserrat-Bold", "Montserrat_700Bold"], size, .bold, .default)
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
