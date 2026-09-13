// Real body for the C5 tool registered as a stub by C1's server.ts:
// transfer_usdc. Settles USDC on Arc through a Privy server wallet -- never a
// raw Arc private key. Native currency on Arc IS USDC (18 decimals,
// confirmed against docs.arc.io), so a transfer is a plain native-value
// eth_sendTransaction, never an ERC-20 call.

import { createPublicClient, createWalletClient, formatUnits, http, parseUnits } from 'viem';
import { PrivyAPIError, PrivyClient } from '@privy-io/node';
import { createViemAccount } from '@privy-io/node/viem';
import { denied, ok, type Provenance, type SignalStore, type ToolResult } from '../../src/contracts.js';
import type { FloatConfig } from '../../src/config.js';
import type { SignalDigestStore } from '../perception/signalDigest.js';
import { arcExplorerTxUrl, ARC_TESTNET } from './arcChain.js';
import { buildAuthorizationContext, buildPrivyClient } from './privyClient.js';

export type SettlementDeps = {
  config: FloatConfig;
  signalStore: SignalStore;
  digestStore: SignalDigestStore;
  /** Injectable for tests; defaults to a real @privy-io/node client. */
  privyClient?: PrivyClient;
  /** Injectable for tests; defaults to Arc's public testnet RPC. */
  rpcUrl?: string;
  /** Injectable for tests; defaults to viem's real publicClient.getBalance. */
  getBalanceImpl?: (address: `0x${string}`) => Promise<bigint>;
  /** Injectable for tests; defaults to a real viem walletClient.sendTransaction. */
  sendTransactionImpl?: (args: {
    account: ReturnType<typeof createViemAccount>;
    to: `0x${string}`;
    value: bigint;
  }) => Promise<`0x${string}`>;
};

async function realGetBalance(deps: SettlementDeps, address: `0x${string}`): Promise<bigint> {
  const publicClient = createPublicClient({
    chain: ARC_TESTNET,
    transport: http(deps.rpcUrl ?? ARC_TESTNET.rpcUrls.default.http[0]),
  });
  return publicClient.getBalance({ address });
}

async function realSendTransaction(
  deps: SettlementDeps,
  account: ReturnType<typeof createViemAccount>,
  to: `0x${string}`,
  value: bigint,
): Promise<`0x${string}`> {
  const walletClient = createWalletClient({
    account,
    chain: ARC_TESTNET,
    transport: http(deps.rpcUrl ?? ARC_TESTNET.rpcUrls.default.http[0]),
  });
  return walletClient.sendTransaction({ to, value });
}

/** A Privy refusal must be visibly Privy's -- that is the entire point of the
 * integration, so this only fires on a real `PrivyAPIError` thrown by the SDK,
 * never a denial we synthesize ourselves. Returns null for anything else
 * (network errors, etc.), which the caller reports as `deployment_unavailable`. */
function extractPrivyPolicyDenial(err: unknown): string | null {
  if (!(err instanceof PrivyAPIError)) return null;
  const status = 'status' in err ? (err as { status?: number }).status : undefined;
  const body = 'error' in err ? (err as { error?: unknown }).error : undefined;
  const bodyMessage =
    body && typeof body === 'object' && 'message' in body ? String((body as { message: unknown }).message) : null;
  return `Privy ${status ?? 'refusal'}: ${bodyMessage ?? err.message}`;
}

export async function transferUsdc(
  args: { to: string; amount: string; signal_ref: string },
  deps: SettlementDeps,
): Promise<ToolResult<unknown>> {
  // Refuse any transfer without a signal_ref resolving in the C2 signal
  // store -- the one rule that makes "clear decision logic tied to real
  // signals" mechanical, before anything else is even checked.
  const signal = deps.signalStore.get(args.signal_ref);
  if (!signal) {
    return denied(
      'no_signal_cited',
      `signal_ref "${args.signal_ref}" does not resolve to a known perception-layer query result`,
    );
  }

  let amountWei: bigint;
  try {
    amountWei = parseUnits(args.amount, 18);
  } catch {
    return denied('deployment_unavailable', `amount "${args.amount}" is not a valid decimal USDC amount`);
  }
  if (amountWei <= 0n) {
    return denied('deployment_unavailable', `amount "${args.amount}" must be positive`);
  }

  // DRY_RUN (C1) stubs every chain write with a synthetic tx id -- honored
  // here exactly as documented in .env.example, never bypassed just because
  // this is the first write-capable tool to wire it up. The signal_ref and
  // amount checks above still apply: a dry run rehearses the real gate, it
  // doesn't skip it.
  if (deps.config.dryRun) {
    return ok({
      dryRun: true,
      txHash: `dryrun_${signal.id}_${Date.now().toString(36)}`,
      to: args.to,
      amount: args.amount,
      signalRef: signal.id,
    });
  }

  if (!deps.config.configured.privy) {
    return denied(
      'deployment_unavailable',
      'Privy server wallet not configured -- need PRIVY_APP_ID, PRIVY_APP_SECRET, PRIVY_AUTHORIZATION_KEY, PRIVY_WALLET_ID and PRIVY_WALLET_ADDRESS',
    );
  }

  const walletAddress = deps.config.raw.PRIVY_WALLET_ADDRESS as `0x${string}`;
  const getBalance = deps.getBalanceImpl ?? ((address: `0x${string}`) => realGetBalance(deps, address));
  const balance = await getBalance(walletAddress);

  // Over-float: the hot wallet's actual balance can't cover this transfer.
  // The custody layer (C6) doesn't exist yet -- this is a clearly marked
  // seam for it to fill in later, exactly as GRANT_SIGNER=ledger was the
  // seam for the policy ticket. Never waits, never fakes a top-up.
  if (amountWei > balance) {
    return denied(
      'awaiting_device',
      `requested ${args.amount} USDC exceeds the hot wallet's float (${formatUnits(balance, 18)} USDC available) -- awaiting treasury replenishment via C6`,
    );
  }

  const privy = deps.privyClient ?? buildPrivyClient(deps.config);
  const account = createViemAccount(privy, {
    walletId: deps.config.raw.PRIVY_WALLET_ID as string,
    address: walletAddress,
    authorizationContext: buildAuthorizationContext(deps.config),
  });

  const sendTransaction =
    deps.sendTransactionImpl ??
    (({ account: acct, to, value }: { account: ReturnType<typeof createViemAccount>; to: `0x${string}`; value: bigint }) =>
      realSendTransaction(deps, acct, to, value));

  let txHash: `0x${string}`;
  try {
    txHash = await sendTransaction({ account, to: args.to as `0x${string}`, value: amountWei });
  } catch (err) {
    const policyDenial = extractPrivyPolicyDenial(err);
    if (policyDenial) {
      return denied('provider_policy_denied', policyDenial);
    }
    return denied('deployment_unavailable', err instanceof Error ? err.message : String(err));
  }

  const queriedAt = new Date().toISOString();
  const digest = deps.digestStore.get(signal.id);
  const provenance: Provenance = { source: 'privy', queriedAt };
  return ok(
    {
      txHash,
      explorerUrl: arcExplorerTxUrl(txHash),
      to: args.to,
      amount: args.amount,
      signalRef: signal.id,
      // Echoed so "cited a real signal" is demonstrable, not just an id
      // lookup -- proves the transfer was grounded in what the signal
      // actually said, not merely that some signal existed.
      signalDigest: digest?.digest ?? null,
    },
    provenance,
  );
}
