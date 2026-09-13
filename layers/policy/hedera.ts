// Hedera client wiring for the policy layer. One operator-authenticated
// `Client` per process; every write goes through `runOrDryRun` so DRY_RUN=1
// stubs the network call while still returning a shape callers can log to
// HCS (see audit.ts).
//
// The operator account supplied to this project (0.0.10523774) is an ECDSA
// secp256k1 key from a faucet, not the SDK's default ED25519 — construct it
// with `PrivateKey.fromStringECDSA`, never the generic `fromString`, or every
// signature silently fails to match the account's key type.

import {
  AccountId,
  Client,
  Hbar,
  PrivateKey,
  Transaction,
  TransactionResponse,
} from '@hashgraph/sdk';
import type { FloatConfig } from '../../src/config.js';

export type HederaOperator = {
  accountId: AccountId;
  privateKey: PrivateKey;
};

function requireOperator(config: FloatConfig): HederaOperator {
  const id = config.raw.HEDERA_OPERATOR_ID;
  const key = config.raw.HEDERA_OPERATOR_KEY;
  if (!id || !key) {
    throw new Error('HEDERA_OPERATOR_ID / HEDERA_OPERATOR_KEY not set — cannot reach Hedera testnet');
  }
  return { accountId: AccountId.fromString(id), privateKey: PrivateKey.fromStringECDSA(key) };
}

let cachedClient: Client | null = null;

/** Testnet client authenticated as the operator. Cached per process — the
 * SDK keeps a gRPC channel pool alive per Client instance. */
export function getOperatorClient(config: FloatConfig): Client {
  if (cachedClient) return cachedClient;
  const operator = requireOperator(config);
  cachedClient = Client.forTestnet().setOperator(operator.accountId, operator.privateKey);
  return cachedClient;
}

export function getOperator(config: FloatConfig): HederaOperator {
  return requireOperator(config);
}

/** Mirror node is eventually consistent with consensus by a few seconds;
 * bootstrap and the live-verify script both need to read back what they
 * just wrote, so give it a beat before the first check. */
export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export type MirrorAccountInfo = {
  hasKey: boolean;
  balanceTinybar: number;
};

/** Reads an account's key/balance state straight from the public mirror
 * node REST API — the same source of truth the ticket asked us to verify
 * the hollow-account fix against. */
export async function fetchMirrorAccount(accountId: string): Promise<MirrorAccountInfo> {
  const res = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/accounts/${accountId}`);
  if (!res.ok) throw new Error(`mirror node ${res.status} for ${accountId}`);
  const body = (await res.json()) as { key: unknown; balance?: { balance: number } };
  return {
    hasKey: body.key !== null && body.key !== undefined,
    balanceTinybar: body.balance?.balance ?? 0,
  };
}

/** Completes a HOLLOW account (has a balance/EVM alias but no key on
 * record) by using it as fee payer on a real transaction it signs — a
 * zero-value self-transfer is the cheapest way to do that. No-op if the
 * mirror node already shows a key. Call this once before any other Hedera
 * write in the process. */
export async function ensureOperatorKeyRecorded(config: FloatConfig): Promise<{ completed: boolean; alreadyHadKey: boolean }> {
  const operator = requireOperator(config);
  const before = await fetchMirrorAccount(operator.accountId.toString());
  if (before.hasKey) return { completed: false, alreadyHadKey: true };

  const client = getOperatorClient(config);
  const { TransferTransaction } = await import('@hashgraph/sdk');
  const tx = await new TransferTransaction()
    .addHbarTransfer(operator.accountId, Hbar.fromTinybars(0))
    .freezeWith(client)
    .execute(client);
  await tx.getReceipt(client);

  // Mirror node lags consensus by a few seconds.
  for (let attempt = 0; attempt < 6; attempt++) {
    await sleep(3000);
    const after = await fetchMirrorAccount(operator.accountId.toString());
    if (after.hasKey) return { completed: true, alreadyHadKey: false };
  }
  throw new Error('operator self-transfer confirmed on-chain but mirror node still reports no key after 18s');
}

/** Runs a live SDK write, or fabricates a `dry_run:<n>`-style synthetic
 * receipt when DRY_RUN is on, so every caller gets the same shape either
 * way and audit messages never need to branch on dry-run themselves. */
export async function runOrDryRun<T>(
  config: FloatConfig,
  label: string,
  live: () => Promise<T>,
): Promise<{ dryRun: true; label: string } | { dryRun: false; result: T }> {
  if (config.dryRun) {
    return { dryRun: true, label };
  }
  const result = await live();
  return { dryRun: false, result };
}

export async function executeAndGetReceipt(client: Client, tx: Transaction): Promise<TransactionResponse> {
  const frozen = tx.isFrozen() ? tx : tx.freezeWith(client);
  const response = await frozen.execute(client);
  await response.getReceipt(client);
  return response;
}
