// Buyer-side signing for the x402 exact-Hedera scheme. Uses ONLY the classes
// `@x402/hedera` re-exports (which come from `@hiero-ledger/sdk`, Hedera's
// renamed SDK fork) — never `@hashgraph/sdk`, which the policy layer (#3)
// already uses. The two Hedera SDKs coexist in this repo; this file is the
// explicit boundary between them. See the PR/report for whether that split
// should stay or one side should migrate.

import { PrivateKey, createClientHederaSigner, HBAR_ASSET_ID } from '@x402/hedera';
import { ExactHederaScheme } from '@x402/hedera/exact/client';

export { HBAR_ASSET_ID };

export type PaymentRequirements = {
  scheme: string;
  network: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra: Record<string, unknown>;
};

export type PaymentPayload = {
  x402Version: number;
  scheme: string;
  network: string;
  accepted: PaymentRequirements;
  payload: Record<string, unknown>;
};

function loadBuyerKey(rawKey: string): PrivateKey {
  return PrivateKey.fromStringECDSA(rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`);
}

/** Builds and signs a payment payload for the given requirements, exactly as
 * the rail-proof probe does. The buyer signs with its own key only — the
 * facilitator is the fee payer, so the buyer pays zero fee overhead. */
export async function signPayment(
  buyerAccountId: string,
  buyerRawKey: string,
  requirements: PaymentRequirements,
): Promise<PaymentPayload> {
  const buyerKey = loadBuyerKey(buyerRawKey);
  const signer = createClientHederaSigner(buyerAccountId, buyerKey, { network: 'hedera:testnet' });
  const scheme = new ExactHederaScheme(signer);
  const signed = await scheme.createPaymentPayload(2, requirements as never);
  return {
    x402Version: 2,
    scheme: 'exact',
    network: 'hedera:testnet',
    accepted: requirements,
    payload: signed.payload,
  };
}
