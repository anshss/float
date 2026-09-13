#!/usr/bin/env node
// Blocky402 x402 facilitator liveness + settlement probe (Hedera testnet).
// Re-runnable. Reads the buyer key from float-mcp/.env; never logs it.
//
// This is C4's rail proof: run once (recorded output alongside this file,
// x402-rail-proof.output.txt) BEFORE any payments code was written, per the
// spec's "prove the rail in isolation first" rule. `layers/payments/pay.ts`
// is the real integration built on top of what this proves works; this
// script stays re-runnable for re-verifying the rail itself, never re-run
// live on demo day (pin the recorded output instead).
//
// Usage: node demo/proofs/x402-rail-proof.mjs   (from the float-mcp/ dir)
//
// What it does:
//  1. GET /supported  -> confirm facilitator is alive, dump raw response.
//  2. Build a real TransferTransaction (buyer -> payTo, tiny HBAR amount),
//     sign with the buyer key only, per the @x402/hedera exact scheme.
//  3. POST /verify then POST /settle against the facilitator.
//  4. Poll the testnet mirror node for the resulting transaction id to get
//     an independent, non-facilitator-reported confirmation.
//  5. Report wall-clock latency and HBAR actually spent (via balance diff).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PrivateKey,
  createClientHederaSigner,
  HBAR_ASSET_ID,
} from '@x402/hedera';
import { ExactHederaScheme } from '@x402/hedera/exact/client';

const here = path.dirname(fileURLToPath(import.meta.url));

const API_BASE = 'https://api.testnet.blocky402.com';
const MIRROR_BASE = 'https://testnet.mirrornode.hedera.com';
const BUYER_ACCOUNT_ID = '0.0.10523774';
// Arbitrary funded testnet account to receive the demo payment.
// Falls back to the facilitator's own example payTo if none given.
const PAY_TO = process.env.PAY_TO || '0.0.8011510';
const AMOUNT_TINYBAR = '100000'; // 0.001 HBAR

function loadBuyerKey() {
  const envPath = path.join(here, '..', '..', '.env');
  const text = readFileSync(envPath, 'utf8');
  const line = text.split('\n').find((l) => l.startsWith('HEDERA_OPERATOR_KEY='));
  if (!line) throw new Error('HEDERA_OPERATOR_KEY not found in .env');
  const raw = line.slice('HEDERA_OPERATOR_KEY='.length).trim();
  return PrivateKey.fromStringECDSA(raw.startsWith('0x') ? raw : `0x${raw}`);
}

async function mirrorBalance(accountId) {
  const r = await fetch(`${MIRROR_BASE}/api/v1/accounts/${accountId}`);
  const j = await r.json();
  return j.balance?.balance; // tinybars
}

function toMirrorTxId(txId) {
  // Facilitator returns "0.0.x@sss.nnn"; mirror node wants "0.0.x-sss-nnn".
  const [account, ts] = String(txId).split('@');
  const [sec, nanos] = ts.split('.');
  return `${account}-${sec}-${nanos}`;
}

async function mirrorLookupTx(txId) {
  const url = `${MIRROR_BASE}/api/v1/transactions/${toMirrorTxId(txId)}`;
  const r = await fetch(url);
  if (!r.ok) return { ok: false, status: r.status, body: await r.text() };
  return { ok: true, body: await r.json() };
}

async function main() {
  const t0 = Date.now();
  console.log('== Step 1: GET /supported ==');
  const supportedRes = await fetch(`${API_BASE}/supported`);
  const supportedText = await supportedRes.text();
  console.log('HTTP', supportedRes.status);
  console.log(supportedText);
  if (!supportedRes.ok) {
    console.log('FACILITATOR NOT ALIVE — stopping.');
    return;
  }
  const supported = JSON.parse(supportedText);
  const hederaKind = supported.kinds.find((k) => k.network === 'hedera:testnet');
  if (!hederaKind) {
    console.log('Facilitator does not advertise hedera:testnet — stopping.');
    return;
  }
  const feePayer = hederaKind.extra?.feePayer ?? supported.signers?.['hedera:*']?.[0];
  console.log('feePayer from /supported:', feePayer);
  console.log('HBAR_ASSET_ID from @x402/hedera package:', HBAR_ASSET_ID);

  console.log('\n== Step 2: build + sign payment payload ==');
  const buyerKey = loadBuyerKey();
  const balanceBefore = await mirrorBalance(BUYER_ACCOUNT_ID);
  console.log('buyer balance before (tinybar):', balanceBefore);

  const paymentRequirements = {
    scheme: 'exact',
    network: 'hedera:testnet',
    amount: AMOUNT_TINYBAR,
    payTo: PAY_TO,
    maxTimeoutSeconds: 300,
    asset: HBAR_ASSET_ID,
    extra: { feePayer },
  };

  const signer = createClientHederaSigner(BUYER_ACCOUNT_ID, buyerKey, {
    network: 'hedera:testnet',
  });
  const scheme = new ExactHederaScheme(signer);
  const signed = await scheme.createPaymentPayload(2, paymentRequirements);

  const paymentPayload = {
    x402Version: 2,
    scheme: 'exact',
    network: 'hedera:testnet',
    accepted: paymentRequirements,
    payload: signed.payload,
  };
  const body = JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements });

  console.log('\n== Step 3: POST /verify ==');
  const tVerify0 = Date.now();
  const verifyRes = await fetch(`${API_BASE}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  const verifyJson = await verifyRes.json();
  console.log('HTTP', verifyRes.status, JSON.stringify(verifyJson));
  if (!verifyJson.isValid) {
    console.log('VERIFY FAILED — stopping. Reason:', verifyJson.invalidReason ?? verifyJson.invalidMessage);
    return;
  }

  console.log('\n== Step 4: POST /settle ==');
  const settleRes = await fetch(`${API_BASE}/settle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  const settleJson = await settleRes.json();
  const tSettleDone = Date.now();
  console.log('HTTP', settleRes.status, JSON.stringify(settleJson));
  if (!settleJson.success) {
    console.log('SETTLE FAILED — stopping. Reason:', settleJson.errorReason ?? settleJson.errorMessage);
    return;
  }

  const txId = settleJson.transaction ?? settleJson.txHash ?? settleJson.transactionId;
  console.log('\nSettlement reported transaction id:', txId);

  console.log('\n== Step 5: independent mirror-node confirmation ==');
  // Mirror node needs a moment to index; poll briefly.
  let mirrorResult = null;
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await mirrorLookupTx(txId);
    if (res.ok) { mirrorResult = res.body; break; }
    console.log(`  poll ${i + 1}: not yet indexed (status ${res.status})`);
  }
  console.log('Mirror node result:', JSON.stringify(mirrorResult));

  const balanceAfter = await mirrorBalance(BUYER_ACCOUNT_ID);
  console.log('\nbuyer balance after (tinybar):', balanceAfter);
  if (balanceBefore != null && balanceAfter != null) {
    console.log('HBAR spent (tinybar):', balanceBefore - balanceAfter, '=', (balanceBefore - balanceAfter) / 1e8, 'HBAR');
  }

  const tEnd = Date.now();
  console.log('\n== Timing ==');
  console.log('total wall-clock (supported->settle):', tEnd - t0, 'ms');
  console.log('verify+settle only:', tSettleDone - tVerify0, 'ms');
}

main().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(1);
});
