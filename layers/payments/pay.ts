// pay(url, max) — the buyer-side x402 flow: request -> 402 challenge ->
// policy check (calls into #3's engine via budget.ts) -> pay -> retry -> 200.
// Every refusal is a structured Denial; an over-budget call is refused
// BEFORE any payment is built or sent.

import { encodePaymentSignatureHeader } from '@x402/core/http';
import type { FloatConfig } from '../../src/config.js';
import { denied, ok, type ToolResult, type SignalStore } from '../../src/contracts.js';
import type { SignalDigestStore } from '../perception/signalDigest.js';
import { ROOT_AGENT_ID } from '../policy/engine.js';
import { writeAudit } from '../policy/audit.js';
import { checkRootBudget } from './budget.js';
import { signPayment, type PaymentRequirements } from './signer.js';

export type PayDeps = {
  config: FloatConfig;
  signalStore: SignalStore;
  digestStore: SignalDigestStore;
  fetchImpl?: typeof fetch;
};

type PaymentRequired = { x402Version: number; accepts: PaymentRequirements[]; error?: string };

function tinybarToHbar(tinybar: string): number {
  return Number(tinybar) / 1e8;
}

export async function pay(args: { url: string; max: string }, deps: PayDeps): Promise<ToolResult<unknown>> {
  const doFetch = deps.fetchImpl ?? fetch;
  const { config } = deps;

  const operatorId = config.raw.HEDERA_OPERATOR_ID;
  const operatorKey = config.raw.HEDERA_OPERATOR_KEY;
  if (!operatorId || !operatorKey) {
    return denied('deployment_unavailable', 'HEDERA_OPERATOR_ID/HEDERA_OPERATOR_KEY not configured — pay() has no buyer key to sign with');
  }

  const initial = await doFetch(args.url);
  if (initial.status !== 402) {
    if (initial.ok) return ok(await initial.json());
    return denied('deployment_unavailable', `expected a 402 challenge from ${args.url}, got HTTP ${initial.status}`);
  }

  const challenge = (await initial.json()) as PaymentRequired;
  const requirements = challenge.accepts?.[0];
  if (!requirements) {
    return denied('deployment_unavailable', `402 response from ${args.url} carried no payment requirements`);
  }

  const amountHbar = tinybarToHbar(requirements.amount);
  const maxHbar = Number(args.max);
  if (!Number.isFinite(maxHbar) || amountHbar > maxHbar) {
    return denied(
      'ceiling_exceeded',
      `challenge amount ${amountHbar} HBAR exceeds caller-specified max ${args.max} HBAR for ${args.url}`,
    );
  }

  const budgetCheck = await checkRootBudget(config, amountHbar, deps.fetchImpl);
  if ('denied' in budgetCheck) return budgetCheck;

  const paymentPayload = await signPayment(operatorId, operatorKey, requirements);
  const paymentHeader = encodePaymentSignatureHeader(paymentPayload as never);

  const paid = await doFetch(args.url, { headers: { 'X-PAYMENT': paymentHeader } });
  if (!paid.ok) {
    const errBody = (await paid.json().catch(() => ({}))) as { error?: string };
    return denied('deployment_unavailable', `payment rejected by ${args.url}: ${errBody.error ?? `HTTP ${paid.status}`}`);
  }

  const body = (await paid.json()) as { report: unknown; settlement: { tx: string; network: string; amount?: string } };
  const tx = body.settlement.tx;

  await writeAudit(config, {
    v: 1,
    kind: 'spend',
    agent_id: ROOT_AGENT_ID,
    ts: new Date().toISOString(),
    service: args.url,
    amount: String(amountHbar),
    tx,
  });

  return ok({
    url: args.url,
    amountHbar,
    tx,
    network: body.settlement.network,
    report: body.report,
  });
}
