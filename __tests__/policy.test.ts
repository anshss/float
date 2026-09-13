import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../src/config.js';
import { grantBudget, revokeBudget, spend } from '../layers/policy/engine.js';
import { resetStateForTests } from '../layers/policy/state.js';

// All of these run under DRY_RUN so no network call is made — the engine
// still exercises the full grant/hierarchy/spend/audit code path, just with
// a synthetic tx instead of a live Hedera write.
const dryConfig = () => loadConfig({ DRY_RUN: '1' });

describe('policy engine (DRY_RUN)', () => {
  const originalRootCeiling = process.env.FLOAT_ROOT_CEILING_HBAR;

  beforeEach(() => {
    resetStateForTests();
    process.env.FLOAT_ROOT_CEILING_HBAR = '10';
    delete process.env.GRANT_SIGNER;
  });

  afterEach(() => {
    if (originalRootCeiling === undefined) delete process.env.FLOAT_ROOT_CEILING_HBAR;
    else process.env.FLOAT_ROOT_CEILING_HBAR = originalRootCeiling;
  });

  it('grants a budget within the root ceiling', async () => {
    const result = await grantBudget(dryConfig(), { childId: 'child-a', ceiling: '4', scope: 'lending' });
    expect(result).toMatchObject({ ok: true, data: { agent_id: 'child-a', ceiling_hbar: 4, dry_run: true } });
  });

  it('rejects a single grant above the root ceiling', async () => {
    const result = await grantBudget(dryConfig(), { childId: 'child-a', ceiling: '11', scope: 'lending' });
    expect(result).toMatchObject({ denied: true, reason: 'ceiling_exceeded' });
  });

  it('enforces sum(child ceilings) <= parent ceiling across siblings at grant time', async () => {
    const first = await grantBudget(dryConfig(), { childId: 'child-a', ceiling: '6', scope: 'lending' });
    expect(first).toMatchObject({ ok: true });

    const second = await grantBudget(dryConfig(), { childId: 'child-b', ceiling: '5', scope: 'lending' });
    expect(second).toMatchObject({ denied: true, reason: 'ceiling_exceeded' });

    const fits = await grantBudget(dryConfig(), { childId: 'child-b', ceiling: '4', scope: 'lending' });
    expect(fits).toMatchObject({ ok: true });
  });

  it('re-granting the same child excludes its own prior ceiling from the sibling sum', async () => {
    await grantBudget(dryConfig(), { childId: 'child-a', ceiling: '6', scope: 'lending' });
    const regrant = await grantBudget(dryConfig(), { childId: 'child-a', ceiling: '8', scope: 'lending' });
    expect(regrant).toMatchObject({ ok: true, data: { ceiling_hbar: 8 } });
  });

  it('GRANT_SIGNER=ledger returns awaiting_device and never touches the chain', async () => {
    process.env.GRANT_SIGNER = 'ledger';
    const result = await grantBudget(dryConfig(), { childId: 'child-a', ceiling: '3', scope: 'lending' });
    expect(result).toMatchObject({ denied: true, reason: 'awaiting_device' });
  });

  it('revokes an active grant', async () => {
    await grantBudget(dryConfig(), { childId: 'child-a', ceiling: '3', scope: 'lending' });
    const result = await revokeBudget(dryConfig(), 'child-a');
    expect(result).toMatchObject({ ok: true, data: { revoked: true } });
  });

  it('an over-ceiling spend is denied and never granted more than the ceiling', async () => {
    await grantBudget(dryConfig(), { childId: 'child-a', ceiling: '3', scope: 'lending' });
    const result = await spend(dryConfig(), {
      agentId: 'child-a',
      amountHbar: 5,
      service: 'counterparty_risk',
      toAccountId: '0.0.999',
    });
    expect(result).toMatchObject({ denied: true, reason: 'ceiling_exceeded' });
  });

  it('a within-ceiling spend succeeds', async () => {
    await grantBudget(dryConfig(), { childId: 'child-a', ceiling: '3', scope: 'lending' });
    const result = await spend(dryConfig(), {
      agentId: 'child-a',
      amountHbar: 2,
      service: 'counterparty_risk',
      toAccountId: '0.0.999',
    });
    expect(result).toMatchObject({ ok: true, data: { amount_hbar: 2, dry_run: true } });
  });
});
