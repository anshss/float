// Seller side, required by the Hedera track alongside the buyer flow: a real
// HTTP server gating Float's own premium `counterparty_risk` deep report
// behind x402. There is no public gated demo endpoint in Blocky402's docs to
// buy from, so this is the resource server `pay()` exercises against itself.
//
// Standard x402 division of labor: THIS server calls the facilitator's
// /verify and /settle (the rail-proof probe called them directly from the
// buyer side purely to prove the settlement rail in isolation — that proof
// is done; this is the real two-sided flow the demo drives).

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { decodePaymentSignatureHeader } from '@x402/core/http';
import type { FloatConfig } from '../../src/config.js';
import type { SignalStore } from '../../src/contracts.js';
import type { SignalDigestStore } from '../perception/signalDigest.js';
import { counterpartyRisk } from '../perception/tools.js';
import { getFeePayer, verify, settle, settlementTxId, type FacilitatorDeps } from './facilitator.js';

export const PREMIUM_RISK_PATH_PREFIX = '/premium/counterparty-risk/';
const PRICE_TINYBAR = '50000'; // 0.0005 HBAR — half the rail-proof's demo amount.
const HBAR_ASSET_ID = '0.0.0';

export type ResourceServerDeps = {
  config: FloatConfig;
  signalStore: SignalStore;
  digestStore: SignalDigestStore;
  facilitatorDeps?: FacilitatorDeps;
  /** Public payTo for this gated service. Defaults to our own operator
   * account — the "gated service" is run by Float itself, so the buyer
   * paying the seller is still all Float-controlled funds; nothing external
   * to fund for the demo. */
  payToId?: string;
};

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
}

function payTo(deps: ResourceServerDeps): string {
  return (
    deps.payToId ?? deps.config.raw.FLOAT_PAYTO_ID ?? deps.config.raw.HEDERA_TREASURY_ID ?? deps.config.raw.HEDERA_OPERATOR_ID ?? ''
  );
}

async function handleRiskRequest(req: IncomingMessage, res: ServerResponse, address: string, deps: ResourceServerDeps) {
  const paymentHeader = req.headers['x-payment'];
  if (!paymentHeader || Array.isArray(paymentHeader)) {
    const feePayer = await getFeePayer(deps.facilitatorDeps);
    return json(res, 402, {
      x402Version: 2,
      error: 'payment required',
      resource: { url: req.url ?? PREMIUM_RISK_PATH_PREFIX + address, description: 'Float premium counterparty_risk deep report' },
      accepts: [
        {
          scheme: 'exact',
          network: 'hedera:testnet',
          amount: PRICE_TINYBAR,
          payTo: payTo(deps),
          maxTimeoutSeconds: 300,
          asset: HBAR_ASSET_ID,
          extra: { feePayer },
        },
      ],
    });
  }

  let paymentPayload: { accepted: unknown; [k: string]: unknown };
  try {
    paymentPayload = decodePaymentSignatureHeader(paymentHeader) as typeof paymentPayload;
  } catch {
    return json(res, 400, { error: 'malformed X-PAYMENT header' });
  }

  const x402Body = { x402Version: 2, paymentPayload, paymentRequirements: paymentPayload.accepted };
  const verifyResult = await verify(x402Body, deps.facilitatorDeps);
  if (!verifyResult.isValid) {
    return json(res, 402, { error: verifyResult.invalidReason ?? verifyResult.invalidMessage ?? 'payment invalid' });
  }

  const settleResult = await settle(x402Body, deps.facilitatorDeps);
  if (!settleResult.success) {
    return json(res, 402, { error: settleResult.errorReason ?? settleResult.errorMessage ?? 'settlement failed' });
  }

  const tx = settlementTxId(settleResult);
  const report = await counterpartyRisk({ address }, deps);
  return json(res, 200, {
    report,
    settlement: { tx, network: settleResult.network, amount: settleResult.amount ?? PRICE_TINYBAR },
  });
}

/** Starts the gated resource server on `port` (0 = OS-assigned, useful for
 * tests / `pay()` calling it in-process without a fixed port). */
export function startResourceServer(deps: ResourceServerDeps, port = 0): Server {
  const server = createServer((req, res) => {
    const url = req.url ?? '';
    if (req.method === 'GET' && url.startsWith(PREMIUM_RISK_PATH_PREFIX)) {
      const address = decodeURIComponent(url.slice(PREMIUM_RISK_PATH_PREFIX.length).split('?')[0]);
      handleRiskRequest(req, res, address, deps).catch((err) => {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) });
      });
      return;
    }
    json(res, 404, { error: 'not found' });
  });
  server.listen(port);
  return server;
}
