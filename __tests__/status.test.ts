import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { getPolicyStatus } from '../layers/policy/status.js';
import { loadState, resetStateForTests, saveState } from '../layers/policy/state.js';

function seedState() {
  const state = loadState();
  state.treasury = { accountId: '0.0.999001', privateKey: 'unused-in-tests' };
  state.topicId = '0.0.999002';
  state.agents['child-a'] = { accountId: '0.0.999003', privateKey: 'unused-in-tests' };
  state.policies['child-a'] = {
    agentId: 'child-a',
    parentId: 'root',
    ceilingHbar: 3,
    period: 'unbounded',
    scope: 'lending',
    thresholdForHuman: null,
    allowanceTx: '0.0.1@1.1',
    grantedAt: new Date().toISOString(),
    revoked: false,
  };
  saveState(state);
}

describe('getPolicyStatus (#11 — ground truth, not env-var presence)', () => {
  beforeEach(() => resetStateForTests());

  it('reports unconfigured with no state and no env', async () => {
    const status = await getPolicyStatus(loadConfig({}));
    expect(status).toMatchObject({
      configured: false,
      treasury_account_id: null,
      treasury_source: 'unset',
      topic_id: null,
      topic_source: 'unset',
      agents: [],
    });
  });

  it('falls back to persisted bootstrap state when no HEDERA_TREASURY_*/_TOPIC_ID env vars are set', async () => {
    seedState();
    const status = await getPolicyStatus(
      loadConfig({ DRY_RUN: '1', HEDERA_OPERATOR_ID: '0.0.1', HEDERA_OPERATOR_KEY: 'k' }),
    );
    expect(status.configured).toBe(true);
    expect(status.treasury_account_id).toBe('0.0.999001');
    expect(status.treasury_source).toBe('state');
    expect(status.topic_id).toBe('0.0.999002');
    expect(status.topic_source).toBe('state');
    expect(status.agents).toEqual([
      {
        agent_id: 'child-a',
        account_id: '0.0.999003',
        scope: 'lending',
        ceiling_hbar: 3,
        remaining_hbar: null,
        revoked: false,
      },
    ]);
  });

  it('never returns a private key', async () => {
    seedState();
    const status = await getPolicyStatus(loadConfig({ DRY_RUN: '1' }));
    expect(JSON.stringify(status)).not.toContain('unused-in-tests');
  });

  it('explicit env ids win over persisted state', async () => {
    seedState();
    const status = await getPolicyStatus(
      loadConfig({ DRY_RUN: '1', HEDERA_TREASURY_ID: '0.0.111', HEDERA_TOPIC_ID: '0.0.222' }),
    );
    expect(status.treasury_account_id).toBe('0.0.111');
    expect(status.treasury_source).toBe('env');
    expect(status.topic_id).toBe('0.0.222');
    expect(status.topic_source).toBe('env');
  });

  it('DRY_RUN never attempts a live mirror-node read', async () => {
    seedState();
    const fetchImpl = vi.fn();
    await getPolicyStatus(loadConfig({ DRY_RUN: '1' }), { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('live mode reports allowance remaining from the mirror node in HBAR', async () => {
    seedState();
    const fetchImpl = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            allowances: [
              { owner: '0.0.999001', spender: '0.0.999003', amount: 200000000, amount_granted: 300000000 },
            ],
          }),
        }) as Response,
    );
    const status = await getPolicyStatus(
      loadConfig({ DRY_RUN: '0', HEDERA_OPERATOR_ID: '0.0.1', HEDERA_OPERATOR_KEY: 'k' }),
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(status.agents[0]).toMatchObject({ ceiling_hbar: 3, remaining_hbar: 2 });
    expect(status.allowance_read_error).toBeNull();
  });

  it('a failed mirror-node read degrades to null remaining, never throws', async () => {
    seedState();
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response);
    const status = await getPolicyStatus(
      loadConfig({ DRY_RUN: '0', HEDERA_OPERATOR_ID: '0.0.1', HEDERA_OPERATOR_KEY: 'k' }),
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(status.agents[0].remaining_hbar).toBeNull();
    expect(status.allowance_read_error).toBe('mirror node http 500');
  });
});
