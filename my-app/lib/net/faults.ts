/**
 * Development-only fault injection, so every screen can be seen failing.
 *
 * Set `EXPO_PUBLIC_FAULTS` in `.env.local` and restart Metro, e.g.
 *
 *     EXPO_PUBLIC_FAULTS=503:0.3,network:0.1,slow:0.2
 *
 *   503      — answer with PostgREST's "schema cache" 503 (what 4 Oct looked like)
 *   network  — throw the same TypeError a dropped connection throws
 *   slow     — wait 6–10 s before sending (a stalled server)
 *
 * Each number is the chance per request. Only ever active when `__DEV__` is
 * true; release builds never read it. Auth, edge functions and storage uploads
 * are left alone so a fault cannot sign anybody out.
 */

export interface FaultPlan {
  busy: number;
  network: number;
  slow: number;
}

export type Fault = 'busy' | 'network' | 'slow';

const clamp = (value: number) => (Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0);

export function parseFaults(spec: string | undefined | null): FaultPlan | null {
  if (!spec || !spec.trim()) return null;
  const plan: FaultPlan = { busy: 0, network: 0, slow: 0 };
  for (const part of spec.split(',')) {
    const [rawName, rawChance] = part.split(':').map(piece => piece.trim().toLowerCase());
    const chance = clamp(Number(rawChance));
    if (rawName === '503' || rawName === 'busy') plan.busy = chance;
    else if (rawName === 'network' || rawName === 'offline') plan.network = chance;
    else if (rawName === 'slow') plan.slow = chance;
  }
  return plan.busy + plan.network + plan.slow > 0 ? plan : null;
}

/** One roll per request; at most one fault. */
export function pickFault(plan: FaultPlan, random: number): Fault | null {
  let edge = plan.busy;
  if (random < edge) return 'busy';
  edge += plan.network;
  if (random < edge) return 'network';
  edge += plan.slow;
  if (random < edge) return 'slow';
  return null;
}

export const FAULT_BUSY_BODY = JSON.stringify({
  code: 'PGRST002',
  details: null,
  hint: null,
  message: 'Could not query the database for the schema cache. Retrying.',
});
