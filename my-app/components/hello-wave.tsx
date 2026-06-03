import Animated from 'react-native-reanimated';
import { MaterialIcons } from '@expo/vector-icons';

export function HelloWave() {
  return (
    <Animated.View
      style={{
        animationName: {
          '50%': { transform: [{ rotate: '25deg' }] },
        },
        animationIterationCount: 4,
        animationDuration: '300ms',
      }}>
      <MaterialIcons name="waving-hand" size={28} color="#243036" />
    </Animated.View>
  );
}