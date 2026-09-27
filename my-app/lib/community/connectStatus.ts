/**
 * What the Connect sheet may say, given what we actually know.
 *
 * ── The rule this exists to enforce ────────────────────────────────────────
 *
 * Never claim there is nothing until the server has said so. The sheet used to
 * derive its Up Next card from the list alone, and an empty list meant two
 * different things — "you have no meetups" and "we have not heard back yet" —
 * so every cold start told someone with a walk on Sunday "NOTHING PLANNED /
 * You have no walks booked / Host" until the network answered.
 *
 * Status is about the request, not the data:
 *
 *   unknown   nothing asked yet this session
 *   loading   a request is in the air
 *   ready     the server answered — what we hold is what is true
 *   error     the last request failed or timed out
 *
 * `hasTrails` is about the data, which may be a restored or older answer. The
 * two together decide the view; neither alone can.
 */

export type ConnectStatus = 'unknown' | 'loading' | 'ready' | 'error';

export type ConnectLead =
  /** The real Up Next card: planned, live, undated — or empty, when confirmed. */
  | 'upNext'
  /** A card-shaped placeholder: we do not know yet. */
  | 'skeleton'
  /** We asked and could not find out, and have nothing earlier to show. */
  | 'error';

export interface ConnectView {
  lead: ConnectLead;
  /** The "Plan a meetup" button that only makes sense for someone with none. */
  showEmptyCta: boolean;
  /** A quiet note that what is on screen is an earlier answer being checked. */
  showUpdating: boolean;
  /** Earlier answer on screen, and the check just failed. */
  showRefreshFailed: boolean;
}

export function connectView(status: ConnectStatus, hasTrails: boolean): ConnectView {
  if (hasTrails) {
    return {
      lead: 'upNext',
      showEmptyCta: false,
      showUpdating: status === 'unknown' || status === 'loading',
      showRefreshFailed: status === 'error',
    };
  }
  if (status === 'ready') {
    // The server said: none. Now, and only now, the empty card is the truth.
    return { lead: 'upNext', showEmptyCta: true, showUpdating: false, showRefreshFailed: false };
  }
  return {
    lead: status === 'error' ? 'error' : 'skeleton',
    showEmptyCta: false,
    showUpdating: false,
    showRefreshFailed: false,
  };
}
