import { describe, it, expect, vi } from 'vitest';
import { fetchTopicMessages, decodeAuditMessage } from '../mirrorNode.js';
import { loadFixture } from './fixtures.js';

describe('mirrorNode', () => {
  it('decodes the recorded fixture into topic messages', async () => {
    const fixture = loadFixture('mirror.topic_messages.json') as { messages: unknown[] };
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => fixture }) as Response);
    const result = await fetchTopicMessages('0.0.900001', { baseUrl: 'https://x', fetchImpl });
    expect(result).toEqual({ ok: true, messages: fixture.messages });
  });

  it('decodes a base64 AuditMessage payload', () => {
    const fixture = loadFixture('mirror.topic_messages.json') as { messages: Array<{ message: string }> };
    const decoded = decodeAuditMessage({
      consensus_timestamp: '1',
      topic_id: '0.0.1',
      sequence_number: 1,
      payer_account_id: '0.0.2',
      message: fixture.messages[0].message,
    });
    expect(decoded).toEqual({
      v: 1,
      kind: 'spend',
      agent_id: 'agent-1',
      ts: '2026-09-13T00:00:00Z',
      service: 'compare_markets',
      amount: '2.50',
      tx: '0.0.900002@1700000000.000000002',
    });
  });

  it('returns null for garbage instead of throwing', () => {
    expect(
      decodeAuditMessage({
        consensus_timestamp: '1',
        topic_id: '0.0.1',
        sequence_number: 1,
        payer_account_id: '0.0.2',
        message: 'not-base64-json',
      }),
    ).toBeNull();
  });

  it('surfaces a non-2xx mirror node response as a structured error', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response);
    const result = await fetchTopicMessages('0.0.1', { baseUrl: 'https://x', fetchImpl });
    expect(result).toEqual({ ok: false, error: 'mirror node http 500' });
  });
});
