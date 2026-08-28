import React from 'react';
import { Linking } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { PawtchiModal } from './PawtchiModal';
import { color } from '../constants/design';
import type { ErrorCopy, RecoveryActionId } from '../lib/appError';
import { supportRouteForFailure, type FailureMeta } from '../lib/support/handoff';

/**
 * The blocking failure sheet — PawtchiModal fed by errorCopy(), with the
 * flow-independent recovery actions already wired.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Every screen used to map `failure.actions` onto its own `handleRecovery`,
 * which knew 'retry' and sometimes 'pick_again'. Any other action the copy
 * catalog offered — "Contact support" on an unknown failure, "Go back" on a
 * missing record — fell through the bottom of that if-chain, closed the sheet
 * and did nothing. The button existed, looked tappable, and was dead.
 *
 * So the actions that do not depend on the flow live here (and in ErrorState,
 * via the same lib/support/handoff helper), and screens keep only the ones
 * that genuinely do: retry, pick-again, and their own navigation. New failure
 * sheets get the support door for free, including ones written by someone who
 * never thinks about it.
 *
 * `meta` is optional enrichment: pass it and the composer opens with the right
 * area chip selected and the failure recorded in diagnostics.
 */

interface Props {
  /** Null hides the sheet — pass the screen's failure state straight in. */
  copy: ErrorCopy | null;
  /** Backdrop tap / hardware back. Should clear the failure state. */
  onClose: () => void;
  /**
   * The flow's own recovery. Called for everything this component does not
   * handle itself (retry, pick_again, dismiss, …). The sheet is already closed.
   */
  onAction?: (action: RecoveryActionId) => void;
  icon?: { name: keyof typeof MaterialIcons.glyphMap; color: string };
  meta?: FailureMeta;
}

export function FailureModal({
  copy,
  onClose,
  onAction,
  icon = { name: 'wb-cloudy', color: color.alertDeep },
  meta,
}: Props) {
  const router = useRouter();

  const handle = (action: RecoveryActionId) => {
    // The sheet always closes first: whatever happens next — a retry, a push to
    // the composer, a trip to Settings — happens on the screen behind it, not
    // under a modal the owner has to dismiss afterwards.
    onClose();

    if (action === 'open_settings') {
      Linking.openSettings().catch(() => {});
      return;
    }
    if (action === 'contact_support') {
      router.push(supportRouteForFailure(meta) as never);
      return;
    }
    if (action === 'go_back') {
      // Guarded: a failure can land on the first screen of a stack (a deep
      // link, a tab root), where there is nothing to go back to.
      if (router.canGoBack()) router.back();
      return;
    }
    onAction?.(action);
  };

  return (
    <PawtchiModal
      visible={copy != null}
      onClose={onClose}
      title={copy?.title ?? ''}
      message={copy?.message}
      icon={icon}
      actions={(copy?.actions ?? []).map((a) => ({
        label: a.label,
        onPress: () => handle(a.action),
      }))}
    />
  );
}
