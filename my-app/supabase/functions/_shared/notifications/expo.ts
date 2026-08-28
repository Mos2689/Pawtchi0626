/**
 * Expo Push client — sends, and actually reads what comes back.
 *
 * Every previous send site in this codebase did:
 *
 *     await fetch(EXPO_PUSH_URL, { ... });   // response discarded
 *
 * so nothing ever learned that a token was dead. `DeviceNotRegistered` was
 * never handled, tokens from uninstalled apps accumulated indefinitely, and
 * delivery was unmeasurable in principle. This module returns the tickets so
 * the caller can persist them, and resolves receipts on a later pass.
 *
 * https://docs.expo.dev/push-notifications/sending-notifications/
 */

const EXPO_SEND_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPT_URL = 'https://exp.host/--/api/v2/push/getReceipts';

/** Expo accepts at most 100 messages per send request. */
const SEND_CHUNK = 100;
/** And 1000 receipt ids per lookup; 300 keeps responses small. */
const RECEIPT_CHUNK = 300;

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  sound?: 'default' | null;
  data?: Record<string, unknown>;
  channelId?: string;
  badge?: number;
}

export interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

export interface SendOutcome {
  message: ExpoMessage;
  ticket: ExpoTicket | null;
  /** Set when the whole chunk failed, so the caller can retry the batch. */
  transportError?: string;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Sends in chunks and pairs every message with its ticket by index, which is
 * the ordering Expo guarantees. A chunk that fails at the transport level is
 * reported per-message rather than throwing, so one bad batch cannot lose the
 * rest of the run.
 */
export async function sendPushBatch(messages: ExpoMessage[]): Promise<SendOutcome[]> {
  const outcomes: SendOutcome[] = [];

  for (const batch of chunk(messages, SEND_CHUNK)) {
    try {
      const res = await fetch(EXPO_SEND_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(batch),
      });

      if (!res.ok) {
        const detail = `expo ${res.status}: ${(await res.text()).slice(0, 200)}`;
        for (const message of batch) outcomes.push({ message, ticket: null, transportError: detail });
        continue;
      }

      const payload = (await res.json()) as { data?: ExpoTicket[]; errors?: unknown };
      const tickets = Array.isArray(payload?.data) ? payload.data : [];
      batch.forEach((message, i) => {
        outcomes.push({ message, ticket: tickets[i] ?? null });
      });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      for (const message of batch) outcomes.push({ message, ticket: null, transportError: detail });
    }
  }

  return outcomes;
}

export interface ExpoReceipt {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/** Resolves ticket ids to receipts. Missing ids simply stay unresolved. */
export async function fetchReceipts(
  ticketIds: string[],
): Promise<Record<string, ExpoReceipt>> {
  const receipts: Record<string, ExpoReceipt> = {};

  for (const batch of chunk(ticketIds, RECEIPT_CHUNK)) {
    try {
      const res = await fetch(EXPO_RECEIPT_URL, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: batch }),
      });
      if (!res.ok) {
        console.error(`[expo] getReceipts ${res.status}`);
        continue;
      }
      const payload = (await res.json()) as { data?: Record<string, ExpoReceipt> };
      Object.assign(receipts, payload?.data ?? {});
    } catch (e) {
      console.error('[expo] getReceipts failed:', e instanceof Error ? e.message : String(e));
    }
  }

  return receipts;
}

/**
 * Errors that mean the token is permanently dead and must never be sent to
 * again. Everything else (MessageRateExceeded, MessageTooBig, transient 5xx)
 * is a problem with the send, not the device.
 */
export function isPermanentTokenFailure(errorCode: string | undefined): boolean {
  return errorCode === 'DeviceNotRegistered';
}
