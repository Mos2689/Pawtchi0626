import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { makeShadow } from '../constants/design';

export type DayMacro = {
    date: string;
    dayLabel: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    isToday?: boolean;
};

interface WeeklyNutritionChartProps {
    data: DayMacro[];
}

// Atwater energy factors — the calories each gram of macronutrient yields.
// Calories aren't a fourth nutrient to stack alongside protein/carbs/fat; they
// ARE the energy those three carry. So the bar is built from each macro's
// calorie contribution: the stack height equals the day's calories (from food),
// and each segment is the share of that energy from protein, carbs, or fat.
const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 } as const;

function WeeklyNutritionChart({ data }: WeeklyNutritionChartProps) {
    // One memoized pass keyed on `data`: convert grams → kcal, size each day's
    // bar against the week's biggest day, and split it by energy source.
    const { processedData, maxTotalKcal, hasZeroData } = useMemo(() => {
        const withKcal = data.map(d => {
            const proKcal = (d.protein || 0) * KCAL_PER_G.protein;
            const carbKcal = (d.carbs || 0) * KCAL_PER_G.carbs;
            const fatKcal = (d.fat || 0) * KCAL_PER_G.fat;
            const totalKcal = proKcal + carbKcal + fatKcal;
            return { ...d, proKcal, carbKcal, fatKcal, totalKcal };
        });

        const maxTotalKcal = Math.max(...withKcal.map(d => d.totalKcal), 1);

        const processed = withKcal.map(d => {
            const t = d.totalKcal || 1; // avoid division by zero on empty days
            const hasData = d.totalKcal > 0;
            return {
                ...d,
                proP: hasData ? (d.proKcal / t) * 100 : 0,
                carbP: hasData ? (d.carbKcal / t) * 100 : 0,
                fatP: hasData ? (d.fatKcal / t) * 100 : 0,
            };
        });

        return {
            processedData: processed,
            maxTotalKcal,
            hasZeroData: withKcal.every(d => d.totalKcal === 0),
        };
    }, [data]);

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <View>
                    <Text style={styles.title}>Weekly Nutrition</Text>
                    <Text style={styles.subtitle}>
                        {data[0]?.date ? new Date(data[0].date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase() : ''} —
                        {data[6]?.date ? new Date(data[6].date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase() : ''}
                    </Text>
                </View>
                <View style={styles.legendWrapper}>
                    <LegendItem color="#EF4444" label="PRO" />
                    <LegendItem color="#3B82F6" label="CARB" />
                    <LegendItem color="#F97316" label="FAT" />
                </View>
            </View>

            {/* Stacked Chart — bar height = calories, split by energy source */}
            <View style={styles.chartContainer}>
                {processedData.map((d, i) => {
                    let barHeightPct = hasZeroData ? 15 : (d.totalKcal / maxTotalKcal) * 100;
                    if (barHeightPct < 15) barHeightPct = 15; // Min cap so labels align cleanly

                    return (
                        <View key={i} style={styles.barColumn}>
                            {/* Stack Container */}
                            <View style={[styles.barWrapper, { height: `${barHeightPct}%` }]}>
                                {d.totalKcal === 0 ? (
                                    <View style={[styles.segment, { backgroundColor: '#f1f5f9', height: '100%' }]} />
                                ) : (
                                    <>
                                        <View style={[styles.segment, { backgroundColor: '#F97316', height: `${d.fatP}%` }]} />
                                        <View style={[styles.segment, { backgroundColor: '#3B82F6', height: `${d.carbP}%` }]} />
                                        <View style={[styles.segment, { backgroundColor: '#EF4444', height: `${d.proP}%` }]} />
                                    </>
                                )}
                            </View>
                            {/* X-Axis Label */}
                            <Text style={[styles.dayLabel, d.isToday && styles.dayLabelActive]}>{d.dayLabel}</Text>
                        </View>
                    );
                })}
            </View>

            {/* Reads the chart for the user — bar height IS the calories, so there's
                no separate calorie bar to double-count the macros. */}
            <Text style={styles.caption}>Bar height = daily calories · split by energy source</Text>
        </View>
    );
}

// Memoized: the chart only needs to re-render when its `data` prop changes, not
// on every parent (Health screen) re-render.
export default React.memo(WeeklyNutritionChart);

const LegendItem = ({ color, label }: { color: string, label: string }) => (
    <View style={styles.legendItem}>
        <View style={[styles.legendDot, { backgroundColor: color }]} />
        <Text style={styles.legendText}>{label}</Text>
    </View>
);

const styles = StyleSheet.create({
    container: {
        backgroundColor: '#FFFFFF',
        borderRadius: 32,
        padding: 24,
        ...makeShadow(10, 30, 0.05, '#000'),
        borderWidth: 1,
        borderColor: 'rgba(0,0,0,0.03)',
        marginBottom: 24,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 40,
        flexWrap: 'wrap',
        gap: 12,
    },
    title: {
        fontFamily: 'Montserrat_800ExtraBold',
        fontSize: 22,
        color: '#041015',
        marginBottom: 4,
    },
    subtitle: {
        fontFamily: 'Montserrat_700Bold',
        fontSize: 12,
        color: '#94a3b8',
        letterSpacing: 0.5,
    },
    legendWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
    },
    legendItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    legendDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },
    legendText: {
        fontFamily: 'Montserrat_700Bold',
        fontSize: 10,
        color: '#94a3b8',
    },
    chartContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        height: 180,
        marginTop: 10,
    },
    barColumn: {
        alignItems: 'center',
        justifyContent: 'flex-end',
        height: '100%',
        flex: 1,
    },
    barWrapper: {
        width: 20,
        borderRadius: 10,
        overflow: 'hidden',
        backgroundColor: '#f1f5f9',
        justifyContent: 'flex-end',
    },
    segment: {
        width: '100%',
    },
    dayLabel: {
        marginTop: 16,
        fontFamily: 'Montserrat_700Bold',
        fontSize: 11,
        color: '#94a3b8',
    },
    dayLabelActive: {
        color: '#041015',
        fontWeight: '900',
    },
    caption: {
        marginTop: 18,
        fontFamily: 'Montserrat_500Medium',
        fontSize: 10,
        color: '#94a3b8',
        textAlign: 'center',
        letterSpacing: 0.3,
    },
});
