import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/Theme';
import ConfettiCannon from 'react-native-confetti-cannon';

// The precise order of hotspots
export const WALKTHROUGH_STEPS = [
  'home_calories',
  'home_exercise',
  'log_action',
  'health_tab'
];

interface WalkthroughContextType {
  activeStepKey: string | null;
  completeStep: (key: string) => void;
  showTooltip: (title: string, description: string) => void;
  replayWalkthrough: () => void;
  skipWalkthrough: () => void;
}

const WalkthroughContext = createContext<WalkthroughContextType | null>(null);

export function WalkthroughProvider({ children }: { children: React.ReactNode }) {
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [tooltipState, setTooltipState] = useState<{ visible: boolean; title: string; description: string }>({
    visible: false,
    title: '',
    description: ''
  });
  const [showConfetti, setShowConfetti] = useState(false);

  useEffect(() => {
    loadCompletedSteps();
  }, []);

  const loadCompletedSteps = async () => {
    try {
      const stored = await AsyncStorage.getItem('walkthrough_completed_steps');
      if (stored) {
        // We load the JSON array
        setCompletedSteps(JSON.parse(stored));
      }
    } catch {
      console.warn("Could not load walkthrough state");
    } finally {
      setIsLoaded(true);
    }
  };

  // The active step is the first one in the master sequence that hasn't been completed yet.
  const activeStepKey = isLoaded 
    ? WALKTHROUGH_STEPS.find(step => !completedSteps.includes(step)) || null 
    : null;

  const showTooltip = useCallback((title: string, description: string) => {
    setTooltipState({ visible: true, title, description });
  }, []);

  const completeStep = useCallback(async (key: string) => {
    setTooltipState(prev => ({ ...prev, visible: false }));
    
    // Add to completed array
    if (!completedSteps.includes(key)) {
      const newCompleted = [...completedSteps, key];
      setCompletedSteps(newCompleted);
      await AsyncStorage.setItem('walkthrough_completed_steps', JSON.stringify(newCompleted));

      // If this was the last step, they just finished the walkthrough!
      if (newCompleted.length >= WALKTHROUGH_STEPS.length) {
        setShowConfetti(true);
        // Track completion and award coins
        console.log('Track: walkthrough_completed');
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            const { data: profile } = await supabase.from('profiles').select('paw_coins').eq('id', user.id).single();
            if (profile) {
              await supabase.from('profiles').update({ 
                paw_coins: (profile.paw_coins || 0) + 20, 
                walkthrough_completed: true 
              }).eq('id', user.id);
            }
          }
        } catch {
          // ignore
        }
      } else {
        console.log('Track: walkthrough_step_completed', { key });
      }
    }
  }, [completedSteps]);

  const replayWalkthrough = async () => {
    setCompletedSteps([]);
    await AsyncStorage.removeItem('walkthrough_completed_steps');
    await AsyncStorage.removeItem('walkthrough_completed'); // legacy wipe
  };

  const skipWalkthrough = async () => {
    // Just mark all steps as completed
    setCompletedSteps([...WALKTHROUGH_STEPS]);
    await AsyncStorage.setItem('walkthrough_completed_steps', JSON.stringify(WALKTHROUGH_STEPS));
    setTooltipState(prev => ({ ...prev, visible: false }));
  };

  return (
    <WalkthroughContext.Provider 
      value={{ 
        activeStepKey, 
        completeStep, 
        showTooltip,
        replayWalkthrough,
        skipWalkthrough
      }}
    >
      {children}

      {/* Centered Modal Tooltip */}
      <Modal
        visible={tooltipState.visible}
        transparent={true}
        animationType="fade"
      >
        <View style={styles.modalOverlay}>
          <View style={styles.tooltipBox}>
            <View style={styles.tooltipHeader}>
              <View style={styles.pawIconContainer}>
                <Ionicons name="paw" size={16} color={Colors.light["on-surface"]} />
              </View>
              <TouchableOpacity onPress={() => completeStep(activeStepKey || '')}>
                 <Ionicons name="close" size={24} color={Colors.light["on-surface"]} />
              </TouchableOpacity>
            </View>
            
            <Text style={styles.title}>{tooltipState.title}</Text>
            <Text style={styles.description}>{tooltipState.description}</Text>

            <View style={styles.footer}>
               <TouchableOpacity onPress={skipWalkthrough}>
                 <Text style={styles.skipText}>Skip Tour</Text>
               </TouchableOpacity>
               <TouchableOpacity 
                 style={styles.doneButton}
                 onPress={() => completeStep(activeStepKey || '')}
               >
                 <Text style={styles.doneText}>Got it</Text>
               </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Confetti Explosion Layer */}
      {showConfetti && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
           <ConfettiCannon count={100} origin={{x: 200, y: -20}} fadeOut={true} onAnimationEnd={() => setShowConfetti(false)} />
        </View>
      )}

    </WalkthroughContext.Provider>
  );
}

export function useWalkthrough() {
  const context = useContext(WalkthroughContext);
  if (!context) throw new Error("useWalkthrough must be used within a WalkthroughProvider");
  return context;
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  tooltipBox: {
    backgroundColor: Colors.light.surface,
    borderRadius: 24,
    padding: 24,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  tooltipHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  pawIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.light.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 20,
    color: Colors.light["on-surface"],
    marginBottom: 8,
  },
  description: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    marginBottom: 24,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  skipText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 14,
    color: '#888',
  },
  doneButton: {
    backgroundColor: Colors.light["on-surface"],
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 16,
  },
  doneText: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 14,
    color: Colors.light.surface,
  }
});
