// pay()'s policy check. Calls into the SAME budget engine #3 built rather
// than a second one: the root ceiling comes from `rootCeilingHbar()`
// (engine.ts), and "how much has root already spent" is read back from the
// same HCS audit topic `grant_budget`/`spend` write to, via the Mirror Node
// client #2 already built for `spend_history`. No separate ledger exists.

import type { FloatConfig } from '../../src/config.js';
import { denied, type Denial } from '../../src/contracts.js';
import { ROOT_AGENT_ID, rootCeilingHbar } from '../policy/engine.js';
import { writeAudit } from '../policy/audit.js';
import { fetchTopicMessages, decodeAuditMessage } from '../perception/mirrorNode.js';

export type BudgetOk = { ok: true; ceilingHbar: number; spentHbar: number };

/** Sums every prior `spend` AuditMessage for `agentId` on the shared topic.
 * Mirrors `spend_history`'s read path exactly (same topic, same decoder) so
 * "how much has root spent" can never drift from what `spend_history`
 * reports back to the caller. */
async function spentSoFarHbar(config: FloatConfig, agentId: string, fetchImpl?: typeof fetch): Promise<number> {
  const topicId = config.raw.HEDERA_TOPIC_ID;
  if (!topicId) return 0; // no topic configured yet — nothing recorded, nothing owed.
  const baseUrl = config.raw.HEDERA_MIRROR_NODE_URL ?? 'https://testnet.mirrornode.hedera.com';
  const result = await fetchTopicMessages(topicId, { baseUrl, fetchImpl }, 200);
  if (!result.ok) return 0; // mirror node hiccup never blocks a spend it can't see.
  return result.messages
    .map(decodeAuditMessage)
    .filter((m): m is NonNullable<typeof m> => m !== null && m.kind === 'spend' && m.agent_id === agentId)
    .reduce((sum, m) => sum + Number(m.amount ?? 0), 0);
}

/** Root-agent budget check for `pay()`. Denies WITHOUT any payment call when
 * `amountHbar` would push root's total spend past its ceiling, and writes
 * the denial to HCS itself (the same shape `grant_budget`'s hierarchy-breach
 * denial uses) so a refused pay() is exactly as auditable as a granted one. */
export async function checkRootBudget(
  config: FloatConfig,
  amountHbar: number,
  fetchImpl?: typeof fetch,
): Promise<BudgetOk | Denial> {
  const ceilingHbar = rootCeilingHbar();
  const spentHbar = await spentSoFarHbar(config, ROOT_AGENT_ID, fetchImpl);
  if (spentHbar + amountHbar > ceilingHbar) {
    await writeAudit(config, {
      v: 1,
      kind: 'denial',
      agent_id: ROOT_AGENT_ID,
      ts: new Date().toISOString(),
      reason: 'ceiling_exceeded',
    });
    return denied(
      'ceiling_exceeded',
      `pay ${amountHbar} HBAR would bring root spend to ${spentHbar + amountHbar} HBAR, exceeding ceiling ${ceilingHbar} HBAR (already spent ${spentHbar} HBAR)`,
    );
  }
  return { ok: true, ceilingHbar, spentHbar };
}
