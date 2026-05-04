import React, { useEffect, useRef } from 'react';
import { View, Animated, Easing, StyleSheet } from 'react-native';

interface Props {
    progress: number; // 0 to 1
    fillColor: string;
    backgroundColor: string;
    children?: React.ReactNode;
}

export function LiquidFillCard({ progress, fillColor, backgroundColor, children }: Props) {
    const animatedValue = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.loop(
            Animated.timing(animatedValue, {
                toValue: 1,
                duration: 3500,
                easing: Easing.linear,
                useNativeDriver: true,
            })
        ).start();
    }, [animatedValue]);

    const spin = animatedValue.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', '360deg']
    });

    return (
        <View style={[styles.container, { backgroundColor }]}>
            {/* Target fluid height container */}
            <View style={[styles.fillBounds, { height: `${Math.min(Math.max(progress * 100, 0), 100)}%` }]}>
                {/* We place the colored liquid expanding beneath this line */}
                <View style={[styles.liquidFloor, { backgroundColor: fillColor }]} />

                {/* The rotating squircle. It matches the card's background color, cutting chunks out of the liquid floor */}
                <Animated.View style={[
                    styles.waveCutout,
                    {
                        backgroundColor,
                        transform: [{ rotate: spin }]
                    }
                ]} />
            </View>

            {/* Content wrapper */}
            <View style={styles.childContainer}>
                {children}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        overflow: 'hidden',
        position: 'relative',
        borderRadius: 24,
    },
    fillBounds: {
        position: 'absolute',
        bottom: 0, left: 0, right: 0,
        width: '100%',
        overflow: 'visible', // Must allow the wave cutout to spill around
    },
    liquidFloor: {
        position: 'absolute',
        top: 0, bottom: 0, left: 0, right: 0,
    },
    waveCutout: {
        position: 'absolute',
        // We anchor it directly at the TOP edge of the liquid floor
        top: -480,
        left: '50%',
        marginLeft: -250, // Center theoretically
        width: 500,
        height: 500,
        borderRadius: 215, // Creates the off-axis wobble
        opacity: 1,
    },
    childContainer: {
        flex: 1,
        zIndex: 10,
        justifyContent: 'center',
        alignItems: 'center',
    }
});
