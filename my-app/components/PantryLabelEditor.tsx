import React, { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { color, font, radius, space } from '../constants/design';
import { energyTolerance } from '../lib/mealLogKcal';
import type { NutritionField, PantryItem, Provenance } from '../store/useActivePetStore';

/**
 * Correct what the scan read off a label.
 *
 * ── Why owners get to edit this, when they do not get to set their pet's
 *    calorie target ──
 *
 * The two look similar and are not. A daily calorie target is a clinical
 * calculation, and inviting someone to overrule it with an opinion is how a
 * healthy dog ends up on an unnecessary restriction. This is a TRANSCRIPTION of
 * a number printed on a packet the owner is physically holding. They have
 * ground truth; we have an OCR guess from a photo taken in a kitchen. That is
 * precisely the case where the person should win.
 *
 * ── What editing here actually unlocks ──
 *
 * Confirming a figure marks it `owner_corrected`, which is one of only two
 * provenances that count as independently observed. Until at least the three
 * calorie-relevant fields are observed, every meal from this food resolves to
 * `quality: 'unverifiable'` — not as a punishment, but because a number derived
 * from another number cannot be used to check it.
 *
 * ── Scope ──
 *
 * Transcription fields only. Nothing derived, nothing clinical. And an edit
 * changes FUTURE math only: past meals keep the snapshot they were logged
 * against, or a correction would silently rewrite the weight plan's own
 * evidence.
 */

type Draft = {
  kcal_per_serving: string;
  serving_grams: string;
  kcal_per_100g_as_fed: string;
  protein_pct: string;
  fat_pct: string;
  fibre_pct: string;
  moisture_pct: string;
  serving_unit: string;
  usual_quantity: string;
};

export interface PantryLabelPatch {
  kcal_per_serving: number | null;
  serving_grams: number | null;
  kcal_per_100g_as_fed: number | null;
  protein_pct: number | null;
  fat_pct: number | null;
  fibre_pct: number | null;
  moisture_pct: number | null;
  serving_unit: string | null;
  nutrition_provenance: Partial<Record<NutritionField, Provenance>>;
  /**
   * How much of this the owner normally serves. Its own field, deliberately.
   *
   * Accepting "make this the usual" used to write
   * `kcal_per_serving = kcal_per_serving × multiplier` onto the pantry row —
   * putting a PORTION inside a LABEL FACT. The manufacturer's calories per
   * serving are not ours to edit because somebody feeds a bit more than the
   * packet suggests.
   */
  usual_portion: { mode: string; quantity: number } | null;
}

interface Props {
  visible: boolean;
  item: PantryItem | null;
  onClose: () => void;
  /** Return false when the save failed and the sheet should stay open. */
  onSave: (patch: PantryLabelPatch) => Promise<boolean | void> | boolean | void;
  /**
   * Some callers complete a paused workflow and own visibility themselves.
   * They can suppress the automatic onClose callback so it cannot also run
   * their cancel path after a successful save.
   */
  closeOnSave?: boolean;
  /**
   * Copy overrides for the other reason this sheet opens: not "the scan may
   * have misread this" but "the packet never printed it". Most pet food states
   * an energy density and a feeding table instead of calories per serving, and
   * telling that owner their photo was unclear would be a lie — the photo was
   * fine, the number simply is not on the bag.
   */
  title?: string;
  intro?: string;
}

const UNITS = ['gram', 'cup', 'pouch', 'can', 'tray', 'sachet', 'piece'];

const num = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const str = (v: number | null | undefined): string =>
  v === null || v === undefined ? '' : String(v);

export function PantryLabelEditor({
  visible,
  item,
  onClose,
  onSave,
  closeOnSave = true,
  title,
  intro,
}: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  // Re-seed whenever a different item opens.
  const seedKey = `${item?.id ?? 'none'}:${visible}`;
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (visible && item && seededFor !== seedKey) {
    setSeededFor(seedKey);
    setDraft({
      kcal_per_serving: str(item.kcal_per_serving),
      serving_grams: str(item.serving_grams),
      kcal_per_100g_as_fed: str(item.kcal_per_100g_as_fed),
      protein_pct: str(item.protein_pct),
      fat_pct: str(item.fat_pct),
      fibre_pct: str(item.fibre_pct),
      moisture_pct: str(item.moisture_pct),
      serving_unit: item.serving_unit ?? '',
      usual_quantity: str(item.usual_portion?.quantity ?? null),
    });
  }

  const d = draft;

  /**
   * The live cross-check, run as the owner types.
   *
   * kcal_per_serving, kcal_per_100g and serving_grams are over-determined — any
   * two fix the third — so an inconsistent trio is catchable at the moment of
   * entry, by the person holding the tub. That is the cheapest possible place
   * to catch it: far better than storing it and finding out via a 24,000 kcal
   * warning three days later.
   *
   * Same tolerance as the resolver and the database trigger, because they are
   * checking the same arithmetic.
   */
  const check = useMemo(() => {
    if (!d) return null;
    const kcal = num(d.kcal_per_serving);
    const grams = num(d.serving_grams);
    const density = num(d.kcal_per_100g_as_fed);
    if (kcal === null || grams === null || density === null) {
      return {
        state: 'incomplete' as const,
        text: 'Fill in all three and we can check them against each other.',
      };
    }
    const expected = (density * grams) / 100;
    const agrees = Math.abs(kcal - expected) <= energyTolerance(expected);
    return agrees
      ? {
          state: 'ok' as const,
          text: `${density} kcal/100 g × ${grams} g = ${Math.round(expected)} kcal ✓`,
        }
      : {
          state: 'conflict' as const,
          text: `${density} kcal/100 g × ${grams} g = ${Math.round(expected)} kcal, but the serving says ${kcal}. One of the three is misread.`,
        };
  }, [d]);

  const pctSum = useMemo(() => {
    if (!d) return 0;
    return (['protein_pct', 'fat_pct', 'fibre_pct', 'moisture_pct'] as const)
      .reduce((sum, k) => sum + (num(d[k]) ?? 0), 0);
  }, [d]);

  const set = (k: keyof Draft, v: string) =>
    setDraft((prev) => (prev ? { ...prev, [k]: v } : prev));

  // The unit the usual portion is counted in, derived from how the food is
  // measured. Stored alongside the number so it can never be reinterpreted in
  // the wrong unit later — the mistake that made a 200 g serve into 200 serves.
  const usualMode: 'weight' | 'count' | 'fraction' = useMemo(() => {
    const u = (d?.serving_unit ?? '').toLowerCase();
    if (u === 'gram' || u === 'g') return 'weight';
    if (u === 'piece') return 'count';
    return 'fraction';
  }, [d?.serving_unit]);

  const usualQty = d ? num(d.usual_quantity) : null;

  const usualUnitLabel =
    usualMode === 'weight' ? 'grams' : usualMode === 'count' ? 'pieces' : `× ${d?.serving_unit || 'serving'}`;

  const handleSave = async () => {
    if (!d || !item || saving) return;
    setSaving(true);
    try {
      // Only fields the owner actually changed are attributed to them. Marking
      // an untouched value 'owner_corrected' would be putting words in their
      // mouth — and it is exactly the claim that unlocks 'verified'.
      const provenance: Partial<Record<NutritionField, Provenance>> = {
        ...(item.nutrition_provenance ?? {}),
      };
      const fields: [NutritionField, keyof Draft][] = [
        ['kcal_per_serving', 'kcal_per_serving'],
        ['serving_grams', 'serving_grams'],
        ['kcal_per_100g_as_fed', 'kcal_per_100g_as_fed'],
        ['protein_pct', 'protein_pct'],
        ['fat_pct', 'fat_pct'],
        ['fibre_pct', 'fibre_pct'],
        ['moisture_pct', 'moisture_pct'],
      ];
      for (const [field, key] of fields) {
        const next = num(d[key]);
        const prev = (item as any)[field] ?? null;
        if (next !== prev) provenance[field] = 'owner_corrected';
      }

      const saved = await onSave({
        kcal_per_serving: num(d.kcal_per_serving),
        serving_grams: num(d.serving_grams),
        kcal_per_100g_as_fed: num(d.kcal_per_100g_as_fed),
        protein_pct: num(d.protein_pct),
        fat_pct: num(d.fat_pct),
        fibre_pct: num(d.fibre_pct),
        moisture_pct: num(d.moisture_pct),
        serving_unit: d.serving_unit || null,
        nutrition_provenance: provenance,
        usual_portion: usualQty === null
          ? null
          : { mode: usualMode, quantity: usualQty },
      });
      if (saved !== false && closeOnSave) onClose();
    } finally {
      setSaving(false);
    }
  };

  if (!item || !d) return null;

  const field = (label: string, key: keyof Draft, hint?: string, kb: 'numeric' | 'default' = 'numeric') => (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={d[key]}
        onChangeText={(v) => set(key, v)}
        keyboardType={kb === 'numeric' ? 'decimal-pad' : 'default'}
        placeholder="—"
        placeholderTextColor={color.slateFaint}
      />
      {!!hint && <Text style={styles.fieldHint}>{hint}</Text>}
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheet}
        >
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.cancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.title} numberOfLines={1}>{title ?? 'Check the label'}</Text>
            <TouchableOpacity onPress={handleSave} disabled={saving} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={[styles.save, saving && { opacity: 0.5 }]}>{saving ? 'Saving' : 'Save'}</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.itemName} numberOfLines={2}>
              {item.brand}{item.product_name ? ` ${item.product_name}` : ''}
            </Text>
            <Text style={styles.intro}>
              {intro ?? 'These come from a photo of the packet, so they can be misread. What you type here is treated as the truth — you have the tub in your hand.'}
            </Text>

            {!!item.serving_size_raw && (
              <Text style={styles.rawLabel}>Label said: “{item.serving_size_raw}”</Text>
            )}

            <View style={styles.sectionHead}><Text style={styles.sectionLabel}>SERVING</Text></View>
            {field('Calories per serving (kcal)', 'kcal_per_serving')}
            {field('One serving weighs (g)', 'serving_grams', 'The weight the packet states — any size is fine.')}
            {field('Calories per 100 g', 'kcal_per_100g_as_fed', 'Often printed as kcal/kg — divide that by 10.')}

            {!!check && (
              <View style={[
                styles.check,
                check.state === 'ok' && styles.checkOk,
                check.state === 'conflict' && styles.checkConflict,
              ]}>
                <MaterialIcons
                  name={check.state === 'ok' ? 'check-circle' : check.state === 'conflict' ? 'error-outline' : 'info-outline'}
                  size={16}
                  color={check.state === 'ok' ? color.viz.green : check.state === 'conflict' ? color.error : color.slateMuted}
                />
                <Text style={styles.checkText}>{check.text}</Text>
              </View>
            )}

            <View style={styles.sectionHead}><Text style={styles.sectionLabel}>MEASURED IN</Text></View>
            <View style={styles.unitRow}>
              {UNITS.map((u) => (
                <TouchableOpacity
                  key={u}
                  style={[styles.unitChip, d.serving_unit === u && styles.unitChipOn]}
                  onPress={() => set('serving_unit', u)}
                >
                  <Text style={[styles.unitChipText, d.serving_unit === u && styles.unitChipTextOn]}>{u}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.sectionHead}><Text style={styles.sectionLabel}>GUARANTEED ANALYSIS</Text></View>
            {field('Protein %', 'protein_pct')}
            {field('Fat %', 'fat_pct')}
            {field('Fibre %', 'fibre_pct')}
            {field('Moisture %', 'moisture_pct')}
            {pctSum > 100 && (
              <View style={[styles.check, styles.checkConflict]}>
                <MaterialIcons name="error-outline" size={16} color={color.error} />
                <Text style={styles.checkText}>
                  These add up to {Math.round(pctSum)}%. They all come out of the same
                  100 g, so at least one is misread.
                </Text>
              </View>
            )}

            <View style={styles.sectionHead}><Text style={styles.sectionLabel}>YOUR USUAL PORTION</Text></View>
            {field(`How much you normally serve (${usualUnitLabel})`, 'usual_quantity',
              'Just the amount you actually feed. It pre-fills the portion picker and never changes the label figures above.')}

            <Text style={styles.footnote}>
              Meals you have already logged keep the figures they were logged with.
              This changes what happens from now on.
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(7,32,42,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    maxHeight: '92%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: color.hairline,
  },
  title: { fontFamily: font.bold, fontSize: 16, color: color.ink, flex: 1, textAlign: 'center' },
  cancel: { fontFamily: font.medium, fontSize: 15, color: color.slateMuted },
  save: { fontFamily: font.bold, fontSize: 15, color: color.navy },
  body: { padding: space.xl, paddingBottom: space.xxl * 2 },
  itemName: { fontFamily: font.bold, fontSize: 18, color: color.ink, marginBottom: space.xs },
  intro: { fontFamily: font.regular, fontSize: 13, lineHeight: 19, color: color.slateMuted, marginBottom: space.md },
  rawLabel: {
    fontFamily: font.medium, fontSize: 12, color: color.slateFaint,
    backgroundColor: color.surfaceSubtle, padding: space.sm, borderRadius: radius.md,
  },
  sectionHead: { marginTop: space.xl, marginBottom: space.sm },
  sectionLabel: { fontFamily: font.semibold, fontSize: 11, letterSpacing: 2, color: color.slateFaint },
  field: { marginBottom: space.md },
  fieldLabel: { fontFamily: font.medium, fontSize: 13, color: color.ink, marginBottom: 6 },
  fieldHint: { fontFamily: font.regular, fontSize: 11, color: color.slateFaint, marginTop: 4 },
  input: {
    borderWidth: 1, borderColor: color.hairline, borderRadius: radius.lg,
    paddingHorizontal: space.md, paddingVertical: 10,
    fontFamily: font.medium, fontSize: 15, color: color.ink,
    backgroundColor: color.surfaceSubtle,
  },
  check: {
    flexDirection: 'row', alignItems: 'flex-start', gap: space.sm,
    padding: space.md, borderRadius: radius.lg, marginTop: space.xs,
    backgroundColor: color.surfaceSubtle,
  },
  checkOk: { backgroundColor: 'rgba(34,197,94,0.10)' },
  checkConflict: { backgroundColor: 'rgba(239,68,68,0.10)' },
  checkText: { flex: 1, fontFamily: font.medium, fontSize: 12.5, lineHeight: 18, color: color.ink },
  unitRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  unitChip: {
    paddingHorizontal: space.md, paddingVertical: 8,
    borderRadius: radius.lg, borderWidth: 1, borderColor: color.hairline,
  },
  unitChipOn: { backgroundColor: color.navy, borderColor: color.navy },
  unitChipText: { fontFamily: font.medium, fontSize: 13, color: color.ink },
  unitChipTextOn: { color: color.cream },
  footnote: {
    fontFamily: font.regular, fontSize: 12, lineHeight: 18,
    color: color.slateFaint, marginTop: space.xl,
  },
});
