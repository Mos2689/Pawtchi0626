import { FadeInDown } from 'react-native-reanimated';
import { motion } from '../constants/design';

// Standard staggered screen-entrance. Use on the primary vertical sections of a
// screen so every screen breathes in with the same rhythm:
//   <Animated.View entering={entrance(0)}>…</Animated.View>
//   <Animated.View entering={entrance(1)}>…</Animated.View>
// `index` is the section's position from the top (0-based); each subsequent
// section is delayed one beat further.
export function entrance(index = 0) {
  return FadeInDown.duration(motion.duration.slow).delay(index * 60);
}
