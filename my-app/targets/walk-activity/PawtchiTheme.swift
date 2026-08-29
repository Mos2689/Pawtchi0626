//  PawtchiTheme.swift
//
//  The widget extension's mirror of constants/design.ts.
//
//  A widget extension cannot import TypeScript, so these values are the one
//  sanctioned duplication in the whole feature — and they are kept to raw brand
//  constants that have not changed since the brand book, rather than derived
//  tokens. If a value here ever disagrees with constants/design.ts, that file
//  wins. lib/brandYellow.test.ts already scans source for retired yellows and
//  covers this file's extension.
//
//  Source of truth: my-app/constants/design.ts
//    BRAND_YELLOW  #F4F600   color.yellow
//    navy          #07202A   color.navy
//    navyRaised    #0B2A36   color.navyRaised
//    cream         #F4F1EC   color.cream

import SwiftUI
// Explicit, because `UIFont` below is a UIKit type and SwiftUI does not
// reliably re-export UIKit into an app-extension target.
import UIKit

enum PawtchiColor {
  static let yellow = Color(red: 244 / 255, green: 246 / 255, blue: 0 / 255)
  static let navy = Color(red: 7 / 255, green: 32 / 255, blue: 42 / 255)
  static let navyRaised = Color(red: 11 / 255, green: 42 / 255, blue: 54 / 255)
  static let cream = Color(red: 244 / 255, green: 241 / 255, blue: 236 / 255)

  /// The cream opacities design.ts names: creamDim (.66) and creamFaint (.42).
  static let creamDim = cream.opacity(0.66)
  static let creamFaint = cream.opacity(0.42)
}

/// Montserrat, resolved defensively.
///
/// The .ttf files are bundled into this target, but a font that failed to
/// register must degrade to a weight-matched system font rather than to
/// San Francisco Regular — an unstyled card reads as broken, not as neutral.
/// Google ships these with PostScript names like "Montserrat-Bold"; the
/// @expo-google-fonts filenames use "Montserrat_700Bold", so both are tried.
enum PawtchiFont {
  static func medium(_ size: CGFloat) -> Font {
    resolve(["Montserrat-Medium", "Montserrat_500Medium"], size, .medium)
  }

  static func semibold(_ size: CGFloat) -> Font {
    resolve(["Montserrat-SemiBold", "Montserrat_600SemiBold"], size, .semibold)
  }

  static func bold(_ size: CGFloat) -> Font {
    resolve(["Montserrat-Bold", "Montserrat_700Bold"], size, .bold)
  }

  private static func resolve(_ names: [String], _ size: CGFloat, _ weight: Font.Weight) -> Font {
    for name in names where UIFont(name: name, size: size) != nil {
      return .custom(name, size: size)
    }
    return .system(size: size, weight: weight)
  }
}
