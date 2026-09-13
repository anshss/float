// Idempotent account/topic bootstrap. Only HEDERA_OPERATOR_ID/_KEY are
// supplied from outside; the treasury (allowance owner), every per-agent
// spender account, and the audit topic are minted here on first use and then
// persisted to layers/policy/.state/hedera.json so a rerun never mints
// duplicates.
//
// stdout is the MCP protocol stream (stdio transport, src/index.ts) — every
// log in this file goes to console.error, never console.log. Ids are logged
// loudly on creation; private keys never are.

import { AccountCreateTransaction, Hbar, PrivateKey, TopicCreateTransaction } from '@hashgraph/sdk';
import type { FloatConfig } from '../../src/config.js';
import { executeAndGetReceipt, getOperator, getOperatorClient } from './hedera.js';
import { loadState, saveState, type AgentAccount, type PolicyState } from './state.js';

const TREASURY_INITIAL_HBAR = 5;
const AGENT_INITIAL_HBAR = 2;

async function createFundedAccount(config: FloatConfig, initialHbar: number): Promise<AgentAccount> {
  const client = getOperatorClient(config);
  const key = PrivateKey.generateECDSA();
  const tx = new AccountCreateTransaction()
    .setKeyWithoutAlias(key.publicKey)
    .setInitialBalance(new Hbar(initialHbar));
  const response = await executeAndGetReceipt(client, tx);
  const receipt = await response.getReceipt(client);
  const accountId = receipt.accountId;
  if (!accountId) throw new Error('AccountCreateTransaction receipt returned no accountId');
  return { accountId: accountId.toString(), privateKey: key.toStringDer() };
}

/** Creates the treasury (allowance owner) if `state.treasury` is unset.
 * DRY_RUN never mints a real account — it fabricates a placeholder id so
 * downstream code has something to reference, and nothing is persisted. */
export async function ensureTreasury(config: FloatConfig): Promise<AgentAccount> {
  const state = loadState();
  if (state.treasury) return state.treasury;

  if (config.dryRun) {
    const placeholder: AgentAccount = { accountId: 'dry_run.treasury', privateKey: '' };
    return placeholder;
  }

  const treasury = await createFundedAccount(config, TREASURY_INITIAL_HBAR);
  state.treasury = treasury;
  saveState(state);
  console.error(`[float-mcp/policy] created treasury account ${treasury.accountId} (allowance owner)`);
  return treasury;
}

/** Creates a spender account for `agentId` if one doesn't already exist. */
export async function ensureAgentAccount(config: FloatConfig, agentId: string): Promise<AgentAccount> {
  const state = loadState();
  const existing = state.agents[agentId];
  if (existing) return existing;

  if (config.dryRun) {
    return { accountId: `dry_run.agent.${agentId}`, privateKey: '' };
  }

  const account = await createFundedAccount(config, AGENT_INITIAL_HBAR);
  state.agents[agentId] = account;
  saveState(state);
  console.error(`[float-mcp/policy] created spender account for agent "${agentId}": ${account.accountId}`);
  return account;
}

/** Creates the single audit topic if `HEDERA_TOPIC_ID`/`state.topicId` is
 * unset. Every grant/revoke/spend/denial writes one AuditMessage here. */
export async function ensureTopic(config: FloatConfig): Promise<string> {
  const envTopic = config.raw.HEDERA_TOPIC_ID;
  if (envTopic) return envTopic;

  const state = loadState();
  if (state.topicId) return state.topicId;

  if (config.dryRun) {
    return 'dry_run.topic';
  }

  const client = getOperatorClient(config);
  const operator = getOperator(config);
  const tx = new TopicCreateTransaction()
    .setAdminKey(operator.privateKey.publicKey)
    .setSubmitKey(operator.privateKey.publicKey)
    .setTopicMemo('float-mcp audit log (grants, revokes, spends, denials)');
  const response = await executeAndGetReceipt(client, tx);
  const receipt = await response.getReceipt(client);
  const topicId = receipt.topicId;
  if (!topicId) throw new Error('TopicCreateTransaction receipt returned no topicId');

  state.topicId = topicId.toString();
  saveState(state);
  console.error(`[float-mcp/policy] created HCS audit topic ${state.topicId}`);
  return state.topicId;
}

export function getState(): PolicyState {
  return loadState();
}
