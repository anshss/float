// HCS audit writer. Every grant, revoke, spend and denial is exactly one
// `AuditMessage` (src/contracts.ts — the shape #4 binds to; never widen it
// here) submitted to the single topic `ensureTopic` returns.
//
// DRY_RUN still emits the message — to stderr, tagged `dry_run: true` — so
// the offline path exercises the same call sites as the live one.

import { TopicMessageSubmitTransaction } from '@hashgraph/sdk';
import type { AuditMessage } from '../../src/contracts.js';
import type { FloatConfig } from '../../src/config.js';
import { ensureTopic } from './bootstrap.js';
import { executeAndGetReceipt, getOperatorClient } from './hedera.js';

export type AuditResult = {
  topicId: string;
  dryRun: boolean;
  /** Consensus sequence number of the HCS message, or null under DRY_RUN. */
  sequenceNumber: number | null;
};

export async function writeAudit(config: FloatConfig, message: AuditMessage): Promise<AuditResult> {
  const topicId = await ensureTopic(config);

  if (config.dryRun) {
    console.error(`[float-mcp/policy] DRY_RUN audit (topic ${topicId}):`, JSON.stringify(message));
    return { topicId, dryRun: true, sequenceNumber: null };
  }

  const client = getOperatorClient(config);
  const tx = new TopicMessageSubmitTransaction({
    topicId,
    message: JSON.stringify(message),
  });
  const response = await executeAndGetReceipt(client, tx);
  const receipt = await response.getReceipt(client);
  const sequenceNumber = receipt.topicSequenceNumber ? Number(receipt.topicSequenceNumber) : null;
  console.error(
    `[float-mcp/policy] wrote ${message.kind} audit message to topic ${topicId} (seq ${sequenceNumber})`,
  );
  return { topicId, dryRun: false, sequenceNumber };
}
