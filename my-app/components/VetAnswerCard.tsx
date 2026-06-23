import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Typography } from './Typography';
import { color, font, radius, space } from '../constants/design';
import type { VetAnswer } from '../lib/askVet';

interface VetAnswerCardProps {
  answer: VetAnswer;
  petName?: string;
  /** Shown on a red-flag answer as a calm cross-link to the vet-report export. */
  onExportReport?: () => void;
}

// Renders one structured Pawtchi answer. Used for a fresh answer and for any
// item in the history list. Calm by design — the red-flag state is a quiet
// navy note, never an alarm.
export function VetAnswerCard({ answer, petName, onExportReport }: VetAnswerCardProps) {
  const name = petName?.trim() || 'them';
  // `steps` is the action plan; fall back to legacy `suggestions` for older rows.
  const steps = answer.steps?.length ? answer.steps : (answer.suggestions || []);
  const watchFor = answer.watchFor || [];

  // Urgency drives the banner; fall back to legacy redFlag (= "soon") for old rows.
  const urgency = answer.urgency ?? (answer.redFlag ? 'soon' : 'routine');
  const flagText =
    urgency === 'now'
      ? `This is worth a call to ${name}'s vet or an emergency clinic now.`
      : urgency === 'soon'
        ? `Worth booking ${name} in with the vet soon.`
        : null;

  return (
    <View style={styles.wrap}>
      {flagText && (
        <View style={[styles.flag, urgency === 'now' && styles.flagNow]}>
          <MaterialIcons name="health-and-safety" size={18} color={color.navy} />
          <Typography variant="body" weight="semibold" color={color.navy} style={styles.flagText}>
            {flagText}
          </Typography>
        </View>
      )}

      {/* Lead answer */}
      <Typography variant="body" color={color.ink} style={styles.answer}>
        {answer.answer}
      </Typography>

      {/* What stands out */}
      {answer.keyPoints.length > 0 && (
        <View style={styles.section}>
          <Typography variant="caption" color={color.slateFaint} style={styles.sectionLabel}>
            WHAT STANDS OUT
          </Typography>
          {answer.keyPoints.map((point, i) => (
            <View key={i} style={styles.bulletRow}>
              <View style={styles.bulletDot} />
              <Typography variant="body" color={color.slate} style={styles.bulletText}>
                {point}
              </Typography>
            </View>
          ))}
        </View>
      )}

      {/* What you can do — the action plan, visually lifted as the centrepiece */}
      {steps.length > 0 && (
        <View style={styles.planCard}>
          <View style={styles.planHead}>
            <MaterialIcons name="checklist-rtl" size={17} color={color.navy} />
            <Typography variant="label" weight="bold" color={color.navy} style={styles.planTitle}>
              What you can do
            </Typography>
          </View>
          {steps.map((s, i) => (
            <View key={i} style={styles.stepRow}>
              <View style={styles.stepNum}>
                <Typography variant="caption" weight="bold" color={color.navy} style={styles.stepNumText}>
                  {i + 1}
                </Typography>
              </View>
              <Typography variant="body" color={color.ink} style={styles.stepText}>
                {s}
              </Typography>
            </View>
          ))}
        </View>
      )}

      {/* Keep an eye on — observable signs to monitor */}
      {watchFor.length > 0 && (
        <View style={styles.section}>
          <Typography variant="caption" color={color.slateFaint} style={styles.sectionLabel}>
            KEEP AN EYE ON
          </Typography>
          {watchFor.map((w, i) => (
            <View key={i} style={styles.bulletRow}>
              <MaterialIcons name="visibility" size={15} color={color.slateMuted} style={styles.checkIcon} />
              <Typography variant="body" color={color.slate} style={styles.bulletText}>
                {w}
              </Typography>
            </View>
          ))}
        </View>
      )}

      {/* Calm vet note */}
      {!!answer.vetNote && (
        <View style={styles.vetNote}>
          <MaterialIcons name="medical-services" size={15} color={color.slateMuted} />
          <Typography variant="body" color={color.slateMuted} style={styles.vetNoteText}>
            {answer.vetNote}
          </Typography>
        </View>
      )}

      {answer.redFlag && onExportReport && (
        <TouchableOpacity style={styles.exportLink} onPress={onExportReport} activeOpacity={0.7}>
          <MaterialIcons name="ios-share" size={16} color={color.navy} />
          <Typography variant="body" weight="semibold" color={color.navy}>
            Prepare a summary for the vet
          </Typography>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.lg },
  flag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: color.yellowSoft,
    borderRadius: radius.lg,
    padding: space.md,
  },
  flagNow: {
    backgroundColor: color.yellow,
  },
  flagText: { flex: 1, lineHeight: 20 },
  answer: { lineHeight: 23 },
  section: { gap: space.sm },
  sectionLabel: { letterSpacing: 1.4 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  bulletDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: color.slateFaint,
    marginTop: 8,
  },
  checkIcon: { marginTop: 3 },
  bulletText: { flex: 1, lineHeight: 21 },

  // Action plan — lifted block so the "what to do" reads as the centrepiece
  planCard: {
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.hairline,
    padding: space.lg,
    gap: space.md,
  },
  planHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  planTitle: { letterSpacing: 0.2 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  stepNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepNumText: { letterSpacing: 0 },
  stepText: { flex: 1, lineHeight: 21 },
  vetNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    borderTopWidth: 1,
    borderTopColor: color.hairline,
    paddingTop: space.md,
  },
  vetNoteText: { flex: 1, lineHeight: 19, fontFamily: font.regular, fontSize: 13 },
  exportLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    alignSelf: 'flex-start',
  },
});
