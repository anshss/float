// Blocky402 facilitator client — a plain HTTP client, no SDK wrapper exists
// for the facilitator's own REST surface. Request/response shapes here match
// the rail-proof probe (demo/proofs/x402-rail-proof.mjs) exactly: this is the
// known-good reference, not a fresh read of Blocky402's docs.
//
// Testnet-only. Rate limit is 100 req/min per IP, burst 10, no auth required
// (the spec's "10 req/s, 10k settlements/day" figures are Blocky402 MAINNET,
// which is marked "coming soon" and is not live — never repeat those numbers
// for this integration).

const DEFAULT_API_BASE = 'https://api.testnet.blocky402.com';

export type SupportedKind = {
  x402Version: number;
  scheme: string;
  network: string;
  extra?: { feePayer?: string };
};

export type SupportedResponse = {
  x402Version: number;
  kinds: SupportedKind[];
};

export type FacilitatorDeps = {
  apiBase?: string;
  fetchImpl?: typeof fetch;
};

function base(deps: FacilitatorDeps): string {
  return (deps.apiBase ?? DEFAULT_API_BASE).replace(/\/$/, '');
}

/** GET /supported — also doubles as a liveness check; R3 (facilitator
 * availability) is mitigated by calling this before ever building a payload. */
export async function getSupported(deps: FacilitatorDeps = {}): Promise<SupportedResponse> {
  const doFetch = deps.fetchImpl ?? fetch;
  const res = await doFetch(`${base(deps)}/supported`);
  if (!res.ok) throw new Error(`facilitator /supported returned HTTP ${res.status}`);
  return (await res.json()) as SupportedResponse;
}

/** The hedera:testnet `extra.feePayer` from /supported — every payload's
 * `paymentRequirements.extra.feePayer` must match this exactly or the SDK
 * throws before signing (Blocky402 hazard, confirmed against the live
 * facilitator by the rail-proof probe). */
export async function getFeePayer(deps: FacilitatorDeps = {}): Promise<string> {
  const supported = await getSupported(deps);
  const hederaKind = supported.kinds.find((k) => k.network === 'hedera:testnet');
  const feePayer = hederaKind?.extra?.feePayer;
  if (!feePayer) throw new Error('facilitator /supported does not advertise a hedera:testnet feePayer');
  return feePayer;
}

export type VerifyResult = { isValid: boolean; invalidReason?: string; invalidMessage?: string };
export type SettleResult = {
  success: boolean;
  transaction?: string;
  txHash?: string;
  transactionId?: string;
  network?: string;
  amount?: string;
  errorReason?: string;
  errorMessage?: string;
};

async function postJson<T>(url: string, body: unknown, fetchImpl?: typeof fetch): Promise<T> {
  const doFetch = fetchImpl ?? fetch;
  const res = await doFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

export async function verify(
  x402Body: { x402Version: number; paymentPayload: unknown; paymentRequirements: unknown },
  deps: FacilitatorDeps = {},
): Promise<VerifyResult> {
  return postJson<VerifyResult>(`${base(deps)}/verify`, x402Body, deps.fetchImpl);
}

export async function settle(
  x402Body: { x402Version: number; paymentPayload: unknown; paymentRequirements: unknown },
  deps: FacilitatorDeps = {},
): Promise<SettleResult> {
  return postJson<SettleResult>(`${base(deps)}/settle`, x402Body, deps.fetchImpl);
}

export function settlementTxId(result: SettleResult): string | undefined {
  return result.transaction ?? result.txHash ?? result.transactionId;
}

/** Gotcha (confirmed by the rail-proof probe): the facilitator returns
 * transaction ids as `0.0.x@sss.nnnnnnnnn`; the mirror node's REST API
 * requires `0.0.x-sss-nnnnnnnnn`. Not accepted as-is — must reformat. */
export function toMirrorTxId(txId: string): string {
  const [account, ts] = txId.split('@');
  const [sec, nanos] = ts.split('.');
  return `${account}-${sec}-${nanos}`;
}
