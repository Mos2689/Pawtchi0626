// Client helpers for the "Ask Pawtchi" feature.
//
// Wraps the ask-vet Edge Function and the vet_questions table (history +
// remaining-count). The monthly cap is enforced server-side; the count read
// here is for display only.

import { supabase } from './supabase';

export const MONTHLY_CAP = 4;

export type Urgency = 'routine' | 'soon' | 'now';

export interface ClarifyQuestion {
  id: string;
  label: string;
  /** One calm phrase on why this detail helps — shown as context per screen. */
  why?: string;
  /** Tappable quick-pick options; empty array → free-text note. */
  options: string[];
}

export interface ClarifyPayload {
  intro: string;
  questions: ClarifyQuestion[];
}

export interface VetAnswer {
  answer: string;
  keyPoints: string[];
  /** Concrete, actionable steps the owner can take today. */
  steps: string[];
  /** Observable signs to monitor / that signal it's time to involve the vet. */
  watchFor: string[];
  vetNote: string;
  /** How soon the vet should be involved — drives the answer-card banner. */
  urgency?: Urgency;
  redFlag: boolean;
  /**
   * True when the question wasn't about this pet (off-topic, jailbreak,
   * different animal). The server skips persisting it so the monthly allowance
   * is not burned; the client shows a calm redirect rather than the full card.
   */
  offTopic?: boolean;
  /** Legacy field from earlier rows — superseded by `steps`. */
  suggestions?: string[];
}

export interface VetQuestionRecord {
  id: string;
  question: string;
  answer: VetAnswer | null;
  created_at: string;
}

export interface VetFollowupTurn {
  id: string;
  kind: 'followup' | 'checkin';
  ownerText: string;
  answer: VetAnswer | null;
  createdAt: string;
}

export interface VetThread {
  head: VetQuestionRecord;
  turns: VetFollowupTurn[];
  followupsLeft: number;
}

export interface PendingCheckin {
  questionId: string;
  question: string;
  reason: string | null;
}

/** Max owner-initiated follow-ups per case. */
export const FOLLOWUP_CAP = 3;

export interface MonthlyUsage {
  used: number;
  remaining: number;
  cap: number;
  /** ISO date when the allowance resets (first of next month, UTC). */
  resetsAt: string;
}

export type AskResult =
  | { kind: 'answer'; answer: VetAnswer; caseId: string | null; remaining: number; resetsAt: string }
  | { kind: 'clarify'; clarify: ClarifyPayload }
  | { kind: 'limit'; resetsAt: string }
  | { kind: 'error'; message: string };

export type FollowupResult =
  | { kind: 'answer'; answer: VetAnswer; followupsLeft: number }
  | { kind: 'limit' } // 3 follow-ups used for this case
  | { kind: 'error'; message: string };

function monthStartISO(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export function nextMonthResetISO(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

// ── Short-lived caches for the two read helpers the Home screen fires on every
// focus. getPendingCheckin in particular runs 1 + N queries, so caching it cuts
// real round-trips. Invalidated whenever an ask/follow-up writes new data.
const ASK_CACHE_TTL_MS = 60_000;
let _usageCache: { userId: string; at: number; value: MonthlyUsage } | null = null;
let _checkinCache: { petId: string; at: number; value: PendingCheckin | null } | null = null;

export function invalidateAskCache(): void {
  _usageCache = null;
  _checkinCache = null;
}

/**
 * Ask one question about a pet. The server enforces the monthly cap.
 * `clarifyAnswers` carries the owner's follow-up detail and forces a final
 * answer (no further clarifying round). Only the final answer spends allowance.
 */
export async function askVet(
  petId: string,
  question: string,
  clarifyAnswers?: string,
): Promise<AskResult> {
  try {
    const { data, error } = await supabase.functions.invoke('ask-vet', {
      body: { petId, question, clarifyAnswers },
    });

    if (error) {
      // supabase-js wraps a non-2xx response in a FunctionsHttpError whose
      // `.context` is the raw Response. Read it so the real server cause is
      // visible (e.g. function not deployed, missing table) instead of a
      // generic message.
      let serverMsg: string | null = null;
      try {
        const ctx: any = (error as any).context;
        if (ctx && typeof ctx.json === 'function') {
          const body = await ctx.json();
          if (body?.code === 'monthly_limit') {
            return { kind: 'limit', resetsAt: body.resetsAt };
          }
          serverMsg = body?.error ?? null;
        }
      } catch {
        // body wasn't JSON — ignore
      }
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        // eslint-disable-next-line no-console
        console.warn('[askVet] invoke failed:', (error as any)?.message, '| server:', serverMsg);
      }
      return { kind: 'error', message: serverMsg || 'Something went wrong. Please try again in a moment.' };
    }
    if (data?.code === 'monthly_limit') {
      return { kind: 'limit', resetsAt: data.resetsAt };
    }
    if (data?.success && data.clarify?.questions?.length) {
      return { kind: 'clarify', clarify: data.clarify as ClarifyPayload };
    }
    if (data?.success && data.answer) {
      // A new answer spends allowance and may open a check-in → drop cached reads.
      invalidateAskCache();
      return {
        kind: 'answer',
        answer: data.answer as VetAnswer,
        caseId: data.caseId ?? null,
        remaining: data.remaining ?? 0,
        resetsAt: data.resetsAt,
      };
    }
    return { kind: 'error', message: data?.error || 'Could not generate an answer. Please try again.' };
  } catch {
    return { kind: 'error', message: 'Could not reach Pawtchi. Please check your connection and try again.' };
  }
}

/**
 * Add a follow-up or check-in reply to an existing case. Free (doesn't spend the
 * monthly allowance); the server caps owner follow-ups at 3 per case.
 */
export async function askFollowup(
  petId: string,
  parentId: string,
  ownerText: string,
  kind: 'followup' | 'checkin',
): Promise<FollowupResult> {
  try {
    const { data, error } = await supabase.functions.invoke('ask-vet', {
      body: { petId, question: ownerText, parentId, followupKind: kind },
    });
    if (error) {
      let body: any = null;
      try { body = await (error as any).context?.json?.(); } catch { /* not json */ }
      if (body?.code === 'followup_limit') return { kind: 'limit' };
      return { kind: 'error', message: body?.error || 'Something went wrong. Please try again in a moment.' };
    }
    if (data?.code === 'followup_limit') return { kind: 'limit' };
    if (data?.success && data.answer) {
      // A check-in reply resolves the pending nudge → drop cached reads.
      invalidateAskCache();
      return { kind: 'answer', answer: data.answer as VetAnswer, followupsLeft: data.followupsLeft ?? 0 };
    }
    return { kind: 'error', message: data?.error || 'Could not generate an answer. Please try again.' };
  } catch {
    return { kind: 'error', message: 'Could not reach Pawtchi. Please check your connection and try again.' };
  }
}

/** Load a full case thread (head + turns) for the thread view. */
export async function getThread(questionId: string): Promise<VetThread | null> {
  const { data: head } = await supabase
    .from('vet_questions')
    .select('id, question, answer, created_at, followup_count')
    .eq('id', questionId)
    .single();
  if (!head) return null;
  const { data: turns } = await supabase
    .from('vet_followups')
    .select('id, kind, owner_text, answer, created_at')
    .eq('question_id', questionId)
    .order('created_at', { ascending: true });
  return {
    head: { id: head.id, question: head.question, answer: head.answer, created_at: head.created_at },
    turns: (turns || []).map((t: any) => ({
      id: t.id, kind: t.kind, ownerText: t.owner_text, answer: t.answer, createdAt: t.created_at,
    })),
    followupsLeft: Math.max(0, FOLLOWUP_CAP - (head.followup_count ?? 0)),
  };
}

/**
 * The most recent open case with a check-in to surface in-app (due or already
 * pushed) where the owner hasn't replied since. Drives the home check-in nudge.
 */
export async function getPendingCheckin(petId: string, opts?: { force?: boolean }): Promise<PendingCheckin | null> {
  if (!opts?.force && _checkinCache && _checkinCache.petId === petId && (Date.now() - _checkinCache.at) < ASK_CACHE_TTL_MS) {
    return _checkinCache.value;
  }
  const nowISO = new Date().toISOString();
  // Sent check-ins, OR due check-ins (covers in-app even before the push fires).
  const { data } = await supabase
    .from('vet_questions')
    .select('id, question, answer, checkin_sent_at, checkin_due_at')
    .eq('pet_id', petId)
    .eq('status', 'open')
    .or(`checkin_sent_at.not.is.null,and(checkin_due_at.lte.${nowISO})`)
    .order('checkin_sent_at', { ascending: false, nullsFirst: false })
    .limit(5);
  let result: PendingCheckin | null = null;
  for (const c of data || []) {
    const since = c.checkin_sent_at || c.checkin_due_at;
    // Has the owner already replied to this check-in?
    const { count } = await supabase
      .from('vet_followups')
      .select('*', { count: 'exact', head: true })
      .eq('question_id', c.id)
      .eq('kind', 'checkin')
      .gte('created_at', since);
    if ((count ?? 0) === 0) {
      result = { questionId: c.id, question: c.question, reason: c.answer?.checkInReason ?? null };
      break;
    }
  }
  _checkinCache = { petId, at: Date.now(), value: result };
  return result;
}

/** Count this user's questions this calendar month (display only). */
export async function getMonthlyUsage(userId: string, opts?: { force?: boolean }): Promise<MonthlyUsage> {
  if (!opts?.force && _usageCache && _usageCache.userId === userId && (Date.now() - _usageCache.at) < ASK_CACHE_TTL_MS) {
    return _usageCache.value;
  }
  const resetsAt = nextMonthResetISO();
  try {
    const { count } = await supabase
      .from('vet_questions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', monthStartISO());
    const used = count ?? 0;
    const value = { used, remaining: Math.max(0, MONTHLY_CAP - used), cap: MONTHLY_CAP, resetsAt };
    _usageCache = { userId, at: Date.now(), value };
    return value;
  } catch {
    // Fail open on display — the server still enforces the real limit.
    return { used: 0, remaining: MONTHLY_CAP, cap: MONTHLY_CAP, resetsAt };
  }
}

/** Past questions for a pet, newest first. */
export async function getHistory(petId: string, limit = 20): Promise<VetQuestionRecord[]> {
  const { data } = await supabase
    .from('vet_questions')
    .select('id, question, answer, created_at')
    .eq('pet_id', petId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data as VetQuestionRecord[]) || [];
}
