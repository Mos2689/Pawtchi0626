/**
 * A UUID v4, for idempotency keys.
 *
 * `expo-crypto` is not a dependency and this does not warrant adding one. Where
 * the runtime offers a real CSPRNG we use it; otherwise we fall back to
 * Math.random, which is fine for this purpose — the key needs to be UNIQUE, not
 * unguessable. Guessing someone else's key gains nothing: log_meal scopes its
 * ledger lookup to pets the caller owns, so a collided key from another account
 * is rejected rather than answered.
 */
export function randomUUID(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();

  if (c && typeof c.getRandomValues === 'function') {
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant 10
    const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
