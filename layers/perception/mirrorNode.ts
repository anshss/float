// Client for the Hedera Mirror Node REST API. `spend_history` reads Float's
// own HCS audit receipts through here — never through The Graph, which does
// not index Hedera. See CLAUDE.md claim-discipline: "receipts on HCS,
// queryable via Mirror Node," never "indexed by The Graph."

import type { AuditMessage } from '../../src/contracts.js';

export type MirrorTopicMessage = {
  consensus_timestamp: string;
  topic_id: string;
  message: string; // base64-encoded submit-message payload
  sequence_number: number;
  payer_account_id: string;
};

export type MirrorNodeOpts = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type MirrorTopicMessagesResult =
  | { ok: true; messages: MirrorTopicMessage[] }
  | { ok: false; error: string };

/** Reads recent messages from an HCS topic via Mirror Node's REST API
 * (`GET /api/v1/topics/{topicId}/messages`) — normal HTTP, not RPC. */
export async function fetchTopicMessages(
  topicId: string,
  opts: MirrorNodeOpts,
  limit = 100,
): Promise<MirrorTopicMessagesResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl.replace(/\/$/, '')}/api/v1/topics/${topicId}/messages?limit=${limit}&order=desc`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await doFetch(url, { signal: controller.signal });
    if (!res.ok) return { ok: false, error: `mirror node http ${res.status}` };
    const body = (await res.json()) as { messages?: MirrorTopicMessage[] };
    return { ok: true, messages: body.messages ?? [] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timeout);
  }
}

/** Decodes a Mirror Node topic message's base64 payload as a Float
 * `AuditMessage`. Returns null for anything that isn't valid JSON matching
 * the shared shape, rather than throwing on a foreign message on the topic. */
export function decodeAuditMessage(msg: MirrorTopicMessage): AuditMessage | null {
  try {
    const json = Buffer.from(msg.message, 'base64').toString('utf-8');
    const parsed: unknown = JSON.parse(json);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      (parsed as { v?: unknown }).v === 1 &&
      typeof (parsed as { kind?: unknown }).kind === 'string'
    ) {
      return parsed as AuditMessage;
    }
    return null;
  } catch {
    return null;
  }
}
