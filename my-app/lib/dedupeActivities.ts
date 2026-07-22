// dedupeActivities — defensive guardrail against duplicate schedule rows.
//
// The real fix for duplicates lives in the generator (idempotent
// delete-before-insert) and the DB (a partial unique index). This is the belt
// to that suspenders: a pure, read-side collapse so a client whose table
// already holds stacked rows — from before those fixes shipped — never renders
// the same slot twice, and so any future regression is caught (the caller can
// report `removed > 0`) instead of silently shipping a doubled timeline.
//
// Only AI-generated rows are collapsed. A manual log (is_ai_generated=false)
// may legitimately repeat a type/time (two water top-ups in the same minute),
// so those always pass through untouched.

export interface DedupableActivity {
  id: string;
  title?: string | null;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  status?: string | null;
  is_ai_generated?: boolean | null;
}

export interface DedupeResult<T> {
  /** Deduplicated rows (order not guaranteed — callers re-sort the timeline). */
  rows: T[];
  /** How many duplicate rows were dropped. >0 means the DB held stacked rows. */
  removed: number;
}

// Prefer keeping the most meaningful copy: completed > skipped > pending — the
// same ordering the DB dedupe migration uses, so read and write agree.
const STATUS_RANK: Record<string, number> = { completed: 0, skipped: 1, pending: 2 };
const statusRank = (s?: string | null): number =>
  s != null && s in STATUS_RANK ? STATUS_RANK[s] : 3;

/** Matches the DB unique index: (pet scope +) scheduled_date, scheduled_time, title. */
function slotKey(a: DedupableActivity): string {
  return `${a.scheduled_date ?? ''}|${a.scheduled_time ?? ''}|${a.title ?? ''}`;
}

export function dedupeActivities<T extends DedupableActivity>(rows: T[]): DedupeResult<T> {
  const bestByKey = new Map<string, T>();
  const passthrough: T[] = [];
  let removed = 0;

  for (const row of rows) {
    if (!row.is_ai_generated) {
      passthrough.push(row);
      continue;
    }
    const key = slotKey(row);
    const existing = bestByKey.get(key);
    if (!existing) {
      bestByKey.set(key, row);
      continue;
    }
    // A genuine duplicate — keep the better-ranked row, drop the other.
    removed++;
    if (statusRank(row.status) < statusRank(existing.status)) {
      bestByKey.set(key, row);
    }
  }

  return { rows: [...passthrough, ...bestByKey.values()], removed };
}
