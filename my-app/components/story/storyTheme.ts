import { BRAND_YELLOW } from '../../constants/design';

/**
 * Scent Spectrum belongs to the Walk Story viewer only. It intentionally does
 * not consume Pawtchi's product design tokens: the story is an editorial
 * artifact with its own locked palette, typography, rhythm, and line language.
 */
export const storyColor = {
  canvas: '#FFFFFF',
  route: BRAND_YELLOW,
  ink: '#0F0A47',
  inkSoft: 'rgba(15, 10, 71, 0.68)',
  inkMuted: 'rgba(15, 10, 71, 0.46)',
  inkFaint: 'rgba(15, 10, 71, 0.18)',
  inkGhost: 'rgba(15, 10, 71, 0.09)',
} as const;

export const storyFont = {
  display: 'BebasNeue_400Regular',
  body: 'Geist_400Regular',
  bodyMedium: 'Geist_500Medium',
  bodySemibold: 'Geist_600SemiBold',
  mono: 'GeistMono_400Regular',
} as const;

export const storyMetric = {
  referenceWidth: 390,
  horizontalPad: 30,
  lineWidth: 4.5,
  fineLineWidth: 1.15,
  markerRadius: 5.5,
  buttonRadius: 18,
} as const;

export function storyScale(width: number): number {
  return Math.max(0.82, Math.min(1.16, width / storyMetric.referenceWidth));
}

export function scaledStorySize(width: number, base: number): number {
  return Math.round(base * storyScale(width));
}

export function displaySizeFor(text: string, width: number, base = 58): number {
  const lengthPenalty = text.length > 42 ? 14 : text.length > 30 ? 8 : text.length > 20 ? 4 : 0;
  return scaledStorySize(width, base - lengthPenalty);
}
