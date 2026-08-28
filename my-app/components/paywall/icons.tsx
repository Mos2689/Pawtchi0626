/**
 * Inline SVG marks shared by both paywall presentations.
 *
 * Verbatim from app/paywall.tsx. `CloseIcon` and `BrandMark` were previously
 * inlined at three call sites inside that file; naming them here is the only
 * change, and it is what stops the win-back screen from growing a fourth,
 * slightly different X.
 */

import React from 'react';
import Svg, { Path, Rect, Circle } from 'react-native-svg';
import { NAVY, YELLOW } from './theme';

export function FoodScanIcon() {
    return (
        <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
            <Rect x={3} y={3} width={18} height={18} rx={3} stroke={NAVY} strokeWidth={2} />
            <Circle cx={12} cy={12} r={3} stroke={NAVY} strokeWidth={2} />
        </Svg>
    );
}

export function HealthIcon() {
    return (
        <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
            <Path d="M3 17l4-4 4 4 6-8 4 4" stroke={NAVY} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
    );
}

export function ActivityIcon() {
    return (
        <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
            <Path d="M12 4v4M12 16v4M4 12h4M16 12h4" stroke={NAVY} strokeWidth={2} strokeLinecap="round" />
            <Circle cx={12} cy={12} r={3} stroke={NAVY} strokeWidth={2} />
        </Svg>
    );
}

export function RemindersIcon() {
    return (
        <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
            <Path d="M12 3a6 6 0 016 6c0 4-6 9-6 9s-6-5-6-9a6 6 0 016-6z" stroke={NAVY} strokeWidth={2} />
        </Svg>
    );
}

export function StarIcon() {
    return (
        <Svg width={12} height={12} viewBox="0 0 24 24">
            <Path
                d="M12 2l3 7 7 .5-5.5 5L18 22l-6-4-6 4 1.5-7.5L2 9.5 9 9z"
                fill={YELLOW}
                stroke={NAVY}
                strokeWidth={1.5}
            />
        </Svg>
    );
}

export function ArrowIcon() {
    return (
        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
            <Path d="M5 12h14M13 5l7 7-7 7" stroke={NAVY} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
    );
}

export function CloseIcon() {
    return (
        <Svg width={12} height={12} viewBox="0 0 12 12" fill="none">
            <Path d="M1 1l10 10M11 1L1 11" stroke={NAVY} strokeWidth={2} strokeLinecap="round" />
        </Svg>
    );
}

/** The small star inside the "Pawtchi Plus" brand pill. */
export function BrandMark() {
    return (
        <Svg width={10} height={10} viewBox="0 0 10 10" fill="none">
            <Path d="M5 1l1.2 2.4L9 3.8 7 5.8l.4 3L5 7.5 2.6 8.8 3 5.8 1 3.8l2.8-.4z" fill={NAVY} />
        </Svg>
    );
}

export const FEATURE_CHIPS = [
    { label: 'Food Scan', Icon: FoodScanIcon },
    { label: 'Health', Icon: HealthIcon },
    { label: 'Activity', Icon: ActivityIcon },
    { label: 'Reminders', Icon: RemindersIcon },
];
