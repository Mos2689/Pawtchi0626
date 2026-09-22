/**
 * MeetingPointField — say where you meet, and put it on the map.
 *
 * ── The interaction, and why it is a crosshair ──────────────────────────────
 *
 * The pin does not move. The map moves under it. A fixed centre crosshair works
 * identically on MapKit and MapLibre, needs no draggable-marker support from
 * either, and cannot desync from the camera — the pin IS the centre of the
 * viewport, by construction. A draggable marker would have to be projected
 * against a reported camera that only one of the two platforms streams during a
 * gesture (see MAP_CAMERA_STREAMS), which is how a pin ends up lagging a finger
 * on one platform and not the other.
 *
 * ── Search moves the map. It does not choose for you ────────────────────────
 *
 * Typing a place and pressing search flies the map there; the coordinate that
 * gets saved is still wherever the crosshair ends up. That is deliberate. A
 * geocoder resolves "Centennial Park" to somebody's idea of its middle, which
 * is a pond. The gate you actually meet at is thirty seconds of panning away,
 * and only the person planning the walk knows which gate.
 *
 * Search runs on submit, never per keystroke: it is an OS geocoder call, and
 * firing one per letter is both wasteful and, on Android, rate-limited into
 * failure right when someone finishes typing.
 *
 * ── The label survives ──────────────────────────────────────────────────────
 *
 * Real meeting points are "by the gates" and "the bench under the big tree".
 * The map contributes a suggestion when the field is untouched and never
 * overwrites anything typed — see `suggestLabel`. The words are what people
 * read; the pin is how they get near enough to read them.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import WalkMap from '../walk/WalkMap';
import { BreathingPaw } from '../BreathingPaw';
import { color, font, makeShadow, radius, space, type } from '../../constants/design';
import {
  coordinateLabel,
  isMeetingPointReady,
  isPinned,
  meetingPointStatus,
  suggestLabel,
  type MeetingPoint,
} from '../../lib/communityMeetingPoint';
import { geocodePlaceLabel, reverseGeocodeLabel } from '../../lib/walk/geoLabels';
import type { GeoPoint } from '../../lib/walk/geo';
import type { MapCamera } from '../../lib/walk/mapCamera';

/** How long the map must sit still before we ask the OS what it is looking at. */
const SETTLE_MS = 550;

interface MeetingPointFieldProps {
  value: MeetingPoint;
  onChange: (next: MeetingPoint) => void;
  /** Where to open the map when nothing has been chosen yet. */
  fallbackCenter?: GeoPoint | null;
  placeholder?: string;
  style?: object;
}

export function MeetingPointField({
  value,
  onChange,
  fallbackCenter,
  placeholder = 'Where do you meet?',
  style,
}: MeetingPointFieldProps) {
  const [open, setOpen] = useState(false);
  const status = meetingPointStatus(value);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.field, pressed && styles.fieldPressed, style]}
        accessibilityRole="button"
        accessibilityLabel={
          status === 'empty'
            ? placeholder
            : `Meeting point: ${value.label}${isPinned(value) ? ', pinned on the map' : ', not pinned'}. Change it.`
        }
      >
        <View style={[styles.fieldMark, status === 'pinned' && styles.fieldMarkPinned]}>
          <Ionicons
            name={status === 'pinned' ? 'location' : 'location-outline'}
            size={19}
            color={status === 'pinned' ? color.navy : color.slateMuted}
          />
        </View>
        <View style={styles.fieldCopy}>
          <Text
            style={[styles.fieldLabel, status === 'empty' && styles.fieldPlaceholder]}
            numberOfLines={1}
          >
            {status === 'empty' ? placeholder : value.label}
          </Text>
          {status !== 'empty' ? (
            <Text style={styles.fieldMeta} numberOfLines={1}>
              {/* Never "pinned" unless there is a coordinate. A walk planned
                  before this existed has a label and nothing else, and saying
                  otherwise would be the app vouching for a pin it never had. */}
              {status === 'pinned' ? `Pinned · ${coordinateLabel(value)}` : 'Tap to pin it on the map'}
            </Text>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={20} color={color.slateFaint} />
      </Pressable>

      {open ? (
        <MeetingPointPicker
          initial={value}
          fallbackCenter={fallbackCenter}
          onCancel={() => setOpen(false)}
          onConfirm={next => { onChange(next); setOpen(false); }}
        />
      ) : null}
    </>
  );
}

function MeetingPointPicker({
  initial,
  fallbackCenter,
  onCancel,
  onConfirm,
}: {
  initial: MeetingPoint;
  fallbackCenter?: GeoPoint | null;
  onCancel: () => void;
  onConfirm: (next: MeetingPoint) => void;
}) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchMiss, setSearchMiss] = useState(false);
  const [label, setLabel] = useState(initial.label);
  /**
   * Whether the label belongs to a person or to the geocoder.
   *
   * Latched true if the point arrived with a label, because that one was
   * already somebody's decision — reopening the picker must not let a reverse
   * geocode quietly replace a meeting point that has been agreed for a week.
   */
  const labelTouched = useRef(initial.label.trim().length > 0);

  /**
   * Where the map has been TOLD to look. Changing this object recentres it;
   * holding it steady leaves the map alone, which is what makes panning work.
   */
  const [commandedCenter, setCommandedCenter] = useState<GeoPoint | null>(
    isPinned(initial) ? { lat: initial.lat!, lng: initial.lng! } : fallbackCenter ?? null,
  );
  /** Where the map actually is. Null until it reports, then it is the truth. */
  const [reported, setReported] = useState<MapCamera | null>(null);

  const pin = reported?.center ?? commandedCenter;

  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (settleTimer.current) clearTimeout(settleTimer.current); }, []);

  /**
   * Ask what the crosshair is over, once it has stopped moving.
   *
   * Debounced because Android streams camera updates continuously through a
   * drag, and a reverse-geocode per frame is a request storm that ends in the
   * OS refusing to answer at all.
   */
  const onCameraChange = useCallback((camera: MapCamera) => {
    setReported(camera);
    setSearchMiss(false);
    if (labelTouched.current) return;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      void reverseGeocodeLabel(camera.center).then(resolved => {
        // Re-checked after the await: someone can start typing while the OS is
        // still thinking, and the answer must not land on top of them.
        if (labelTouched.current) return;
        setLabel(current => suggestLabel(current, resolved));
      }).catch(() => {});
    }, SETTLE_MS);
  }, []);

  const search = async () => {
    const wanted = query.trim();
    if (wanted.length < 3) return;
    setSearching(true);
    setSearchMiss(false);
    try {
      const found = await geocodePlaceLabel(wanted);
      if (!found) {
        setSearchMiss(true);
        return;
      }
      // A new object every time, including for the same place: this is what
      // tells the map to move, and searching the same name twice should still
      // bring you back rather than do nothing.
      setCommandedCenter({ lat: found.lat, lng: found.lng });
      setReported(null);
      if (!labelTouched.current) setLabel(wanted);
    } catch {
      setSearchMiss(true);
    } finally {
      setSearching(false);
    }
  };

  const candidate: MeetingPoint = {
    label,
    lat: pin?.lat ?? null,
    lng: pin?.lng ?? null,
  };
  const ready = isMeetingPointReady(candidate);

  return (
    <Modal visible animationType="slide" onRequestClose={onCancel} presentationStyle="fullScreen">
      <SafeAreaView style={styles.sheet}>
        <View style={styles.sheetHead}>
          <Pressable onPress={onCancel} hitSlop={10} accessibilityRole="button" accessibilityLabel="Cancel">
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.sheetTitle}>Meeting point</Text>
          <View style={styles.cancelSpacer} />
        </View>

        <View style={styles.searchRow}>
          <Ionicons name="search" size={18} color={color.slateMuted} />
          <TextInput
            value={query}
            onChangeText={next => { setQuery(next); setSearchMiss(false); }}
            onSubmitEditing={() => void search()}
            placeholder="Search for a place"
            placeholderTextColor={color.slateFaint}
            returnKeyType="search"
            autoCorrect={false}
            style={styles.searchInput}
            accessibilityLabel="Search for a place"
          />
          {searching ? (
            <BreathingPaw size={20} workingColor={color.slateMuted} />
          ) : query.trim().length >= 3 ? (
            <Pressable onPress={() => void search()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Search">
              <Text style={styles.searchGo}>Find</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.mapWrap}>
          <WalkMap
            mode="summary"
            path={[]}
            center={commandedCenter}
            interactive
            onCameraChange={onCameraChange}
            style={StyleSheet.absoluteFillObject as any}
          />

          {/* The pin, nailed to the middle of the viewport. Offset upward by
              half its own height so the point of it — not its centre — sits on
              the coordinate being chosen. */}
          <View style={styles.crosshair} pointerEvents="none">
            <View style={styles.pinHalo} />
            <View style={styles.pinStem} />
            <View style={styles.pinHead}>
              <Ionicons name="paw" size={15} color={color.navy} />
            </View>
          </View>

          <View style={styles.hint} pointerEvents="none">
            <Text style={styles.hintText}>
              {searchMiss
                ? 'No match for that. Move the map to the spot instead.'
                : 'Move the map to put the pin exactly where you meet.'}
            </Text>
          </View>
        </View>

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.footer}>
            <Text style={styles.footerLabel}>What do you call this spot?</Text>
            <TextInput
              value={label}
              onChangeText={next => { labelTouched.current = true; setLabel(next); }}
              placeholder="Centennial Park, by the gates"
              placeholderTextColor={color.slateFaint}
              maxLength={100}
              style={styles.labelInput}
              accessibilityLabel="Name of the meeting point"
            />
            <Text style={styles.footerMeta} numberOfLines={1}>
              {coordinateLabel(candidate) ?? 'The map has not settled yet'}
            </Text>
            <Pressable
              onPress={() => onConfirm({ ...candidate, label: candidate.label.trim() })}
              disabled={!ready}
              style={({ pressed }) => [styles.confirm, !ready && styles.confirmDisabled, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.confirmText}>Use this spot</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const PIN_HEAD = 34;

const styles = StyleSheet.create({
  field: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.lg,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.hairline,
    paddingHorizontal: space.lg,
    marginBottom: space.md,
  },
  fieldPressed: { opacity: 0.9 },
  fieldMark: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surfaceSubtle,
  },
  fieldMarkPinned: { backgroundColor: color.yellow },
  fieldCopy: { flex: 1, minWidth: 0 },
  fieldLabel: { ...type.bodyMedium, fontSize: 16, color: color.ink },
  fieldPlaceholder: { color: color.slateFaint },
  fieldMeta: { ...type.caption, fontSize: 10.5, color: color.slateMuted, marginTop: 3 },

  sheet: { flex: 1, backgroundColor: color.surface },
  sheetHead: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
  },
  cancel: { ...type.label, fontSize: 14, color: color.slateMuted, minWidth: 60 },
  cancelSpacer: { minWidth: 60 },
  sheetTitle: { ...type.heading, fontSize: 17, color: color.navy },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 52,
    marginHorizontal: space.lg,
    marginBottom: space.md,
    paddingHorizontal: space.md,
    borderRadius: radius.lg,
    backgroundColor: color.surfaceSubtle,
  },
  searchInput: { flex: 1, minWidth: 0, ...type.bodyMedium, fontSize: 15, color: color.ink },
  searchGo: { ...type.label, fontSize: 13, color: color.electric },

  mapWrap: { flex: 1, overflow: 'hidden', backgroundColor: color.surfaceSubtle },
  crosshair: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinHalo: {
    position: 'absolute',
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: 'rgba(244,246,0,0.28)',
    // Centred on the point of the pin, not on its head.
    marginTop: PIN_HEAD,
  },
  pinHead: {
    position: 'absolute',
    width: PIN_HEAD,
    height: PIN_HEAD,
    borderRadius: PIN_HEAD / 2,
    backgroundColor: color.yellow,
    borderWidth: 2.5,
    borderColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: PIN_HEAD + 6,
    ...makeShadow(4, 10, 0.24),
  },
  pinStem: {
    position: 'absolute',
    width: 2.5,
    height: PIN_HEAD,
    backgroundColor: color.navy,
    marginBottom: 2,
  },

  hint: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    bottom: space.lg,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.94)',
    ...makeShadow(4, 12, 0.10),
  },
  hintText: { ...type.caption, fontSize: 10.5, color: color.slateMuted, textAlign: 'center' },

  footer: {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.md,
    borderTopWidth: 1,
    borderTopColor: color.hairline,
    backgroundColor: color.surface,
  },
  footerLabel: { ...type.caption, color: color.slateMuted, marginBottom: space.sm },
  labelInput: {
    minHeight: 54,
    borderRadius: radius.lg,
    backgroundColor: color.surfaceSubtle,
    paddingHorizontal: space.lg,
    ...type.bodyMedium,
    fontSize: 15,
    color: color.ink,
  },
  footerMeta: { ...type.caption, fontSize: 10, color: color.slateFaint, marginTop: 8, marginLeft: 4 },
  confirm: {
    minHeight: 54,
    borderRadius: radius.lg,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.md,
  },
  confirmDisabled: { opacity: 0.45 },
  confirmText: { fontFamily: font.bold, fontSize: 14, color: color.navy },
  pressed: { opacity: 0.9 },
});
