/**
 * One moment's heart, changed in place — the optimistic half of a heart tap.
 *
 * Returns a new moments array with only that moment replaced, so everything
 * else about the memory (its traces above all) keeps its identity and nothing
 * that depends on it re-renders or re-animates. The count never goes below 0.
 */
export function withHeart<T extends { id: string; heartedByMe?: boolean; heartCount?: number }>(
  moments: readonly T[],
  id: string,
  hearted: boolean,
): T[] {
  return moments.map(moment => {
    if (moment.id !== id || !!moment.heartedByMe === hearted) return moment;
    const delta = hearted ? 1 : -1;
    return { ...moment, heartedByMe: hearted, heartCount: Math.max(0, (moment.heartCount ?? 0) + delta) };
  });
}
