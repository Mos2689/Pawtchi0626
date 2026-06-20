import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';

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

function WeeklyNutritionChart({ data }: WeeklyNutritionChartProps) {
    // All derivation memoized in one pass keyed on `data` (was partly recomputed
    // every render). Normalizes each metric against its week's maximum.
    const { processedData, absoluteMaxTotalS, hasZeroData } = useMemo(() => {
        const maxCal = Math.max(...data.map(d => d.calories), 1);
        const maxPro = Math.max(...data.map(d => d.protein), 1);
        const maxCarb = Math.max(...data.map(d => d.carbs), 1);
        const maxFat = Math.max(...data.map(d => d.fat), 1);

        const processed = data.map(d => {
            const calS = d.calories / maxCal;
            const proS = d.protein / maxPro;
            const carbS = d.carbs / maxCarb;
            const fatS = d.fat / maxFat;

            const totalS = calS + proS + carbS + fatS || 1; // avoid division by zero

            return {
                ...d,
                totalS,
                calP: d.calories === 0 && d.protein === 0 ? 0 : (calS / totalS) * 100,
                proP: d.calories === 0 && d.protein === 0 ? 0 : (proS / totalS) * 100,
                carbP: d.calories === 0 && d.protein === 0 ? 0 : (carbS / totalS) * 100,
                fatP: d.calories === 0 && d.protein === 0 ? 0 : (fatS / totalS) * 100,
            };
        });

        return {
            processedData: processed,
            absoluteMaxTotalS: Math.max(...processed.map(d => d.totalS), 1),
            // If there's literally no data (all 0), show thin empty placeholder bars.
            hasZeroData: data.every(d => d.calories === 0 && d.protein === 0 && d.carbs === 0 && d.fat === 0),
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
                    <LegendItem color="#F7F602" label="CAL" />
                    <LegendItem color="#EF4444" label="PRO" />
                    <LegendItem color="#3B82F6" label="CARB" />
                    <LegendItem color="#F97316" label="FAT" />
                </View>
            </View>

            {/* Stacked Chart */}
            <View style={styles.chartContainer}>
                {processedData.map((d, i) => {
                    let barHeightPct = hasZeroData ? 15 : (d.totalS / absoluteMaxTotalS) * 100;
                    if (barHeightPct < 15) barHeightPct = 15; // Min cap so labels align cleanly

                    return (
                        <View key={i} style={styles.barColumn}>
                            {/* Stack Container */}
                            <View style={[styles.barWrapper, { height: `${barHeightPct}%` }]}>
                                {hasZeroData || d.totalS === 1 && d.calories === 0 ? (
                                    <View style={[styles.segment, { backgroundColor: '#f1f5f9', height: '100%' }]} />
                                ) : (
                                    <>
                                        <View style={[styles.segment, { backgroundColor: '#F97316', height: `${d.fatP}%` }]} />
                                        <View style={[styles.segment, { backgroundColor: '#3B82F6', height: `${d.carbP}%` }]} />
                                        <View style={[styles.segment, { backgroundColor: '#EF4444', height: `${d.proP}%` }]} />
                                        <View style={[styles.segment, { backgroundColor: '#F7F602', height: `${d.calP}%` }]} />
                                    </>
                                )}
                            </View>
                            {/* X-Axis Label */}
                            <Text style={[styles.dayLabel, d.isToday && styles.dayLabelActive]}>{d.dayLabel}</Text>
                        </View>
                    );
                })}
            </View>
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
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.05,
        shadowRadius: 30,
        elevation: 4,
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
});
