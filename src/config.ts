// Config loader. Missing env vars degrade the layer that needs them to a
// structured denial at call time — they never crash the server at startup.
// No key material is ever returned through any tool; `float_status` reports
// only booleans (configured / not configured) for secret fields.

import { z } from 'zod';

const envSchema = z.object({
  GRAPH_API_KEY: z.string().min(1).optional(),
  HEDERA_OPERATOR_ID: z.string().min(1).optional(),
  HEDERA_OPERATOR_KEY: z.string().min(1).optional(),
  HEDERA_TREASURY_ID: z.string().min(1).optional(),
  HEDERA_TREASURY_KEY: z.string().min(1).optional(),
  HEDERA_TOPIC_ID: z.string().min(1).optional(),
  HEDERA_MIRROR_NODE_URL: z.string().min(1).optional(),
  // --- C4: payments (x402 on Hedera via Blocky402) ---
  BLOCKY402_API_BASE: z.string().min(1).optional(),
  FLOAT_PAYTO_ID: z.string().min(1).optional(),
  // nonnegative, not positive: 0 is a real value here (OS-assigned ephemeral
  // port), used by tests and by the demo agent/plugin's stdio launch so a
  // second process never collides with a live float-mcp already bound to
  // the default port — see layers/payments/resourceServer.ts's own `port =
  // 0` default, which this env var previously couldn't reach at all.
  FLOAT_PAYMENTS_PORT: z.coerce.number().int().nonnegative().optional(),
  FLOAT_ROOT_CEILING_HBAR: z.coerce.number().positive().optional(),
  // #17: how much real HBAR bootstrap funds into each newly minted account.
  // The treasury only needs enough to cover the demo's actual transfers (not
  // the 3-5 HBAR it used to get funded with); a spender account only ever
  // pays its own transaction fees, never a transfer amount (transfers move
  // treasury -> counterparty via an approved allowance, never spender ->
  // counterparty from the spender's own balance).
  FLOAT_TREASURY_INITIAL_HBAR: z.coerce.number().positive().optional(),
  FLOAT_AGENT_INITIAL_HBAR: z.coerce.number().positive().optional(),
  PRIVY_APP_ID: z.string().min(1).optional(),
  PRIVY_APP_SECRET: z.string().min(1).optional(),
  PRIVY_WALLET_ID: z.string().min(1).optional(),
  PRIVY_WALLET_ADDRESS: z.string().min(1).optional(),
  // Mandatory to sign from a server wallet; the public half is registered as
  // a key quorum out of band (PRIVY_KEY_QUORUM_ID), never re-derived here.
  PRIVY_AUTHORIZATION_KEY: z.string().min(1).optional(),
  // Only needed by the one-time provisioning script (demo/proofs), never at
  // call time -- signing uses PRIVY_AUTHORIZATION_KEY, not this id.
  PRIVY_KEY_QUORUM_ID: z.string().min(1).optional(),
  LEDGER_CLI_BIN: z.string().min(1).optional(),
  // --- C6: Ledger custody (treasury/float reserve model) ---
  // Sepolia address the treasury press authorizes a movement TO. Earmarked,
  // never derived — a missing value degrades every custody write to a
  // structured denial rather than guessing a destination.
  LEDGER_FUNDING_ADDRESS: z.string().min(1).optional(),
  // BIP-32 path the on-device Ethereum app derives the treasury account
  // from. Matches wallet-cli's own `ethereum-sepolia-1` label (first
  // account, first address).
  LEDGER_DERIVATION_PATH: z.string().min(1).optional(),
  SEPOLIA_RPC_URL: z.string().min(1).optional(),
  // Fixed USD amount a single confirmed press unlocks from the reserve
  // tranche below -- a bookkeeping unit, not a price-oracle conversion of
  // the (dust-sized) testnet ETH actually moved.
  FLOAT_RESERVE_UNLOCK_USD: z.coerce.number().positive().optional(),
  FLOAT_CAP_DEFAULT_USD: z.coerce.number().positive().optional(),
  FLOAT_CAP_HOT_BALANCE_USD: z.coerce.number().positive().optional(),
  DRY_RUN: z
    .string()
    .optional()
    .transform((v) => v === undefined ? undefined : v === '1' || v.toLowerCase() === 'true'),
  // Alternate explicit live opt-in, read only when DRY_RUN itself is unset
  // (see loadConfig below) — named separately from DRY_RUN=0 so an operator
  // reaching for "make it live" doesn't have to remember DRY_RUN's polarity.
  FLOAT_LIVE: z
    .string()
    .optional()
    .transform((v) => v !== undefined && (v === '1' || v.toLowerCase() === 'true')),
});

export type RawEnv = z.infer<typeof envSchema>;

export type LayerName = 'graph' | 'hedera' | 'privy' | 'ledger';

export type FloatConfig = {
  raw: RawEnv;
  /** Whether chain writes are stubbed. `#14`: this is an EXPLICIT opt-in
   * only — `DRY_RUN=0` or `FLOAT_LIVE=1` — never inferred from which env
   * vars happen to be set. The old formula gated this on
   * `HEDERA_TREASURY_ID`/`_KEY`/`HEDERA_TOPIC_ID`, which the policy layer
   * never populates (it bootstraps those into its own state file instead —
   * see layers/policy/state.ts and #11), so the default could never resolve
   * to live in normal operation, AND — had those five env vars ever all
   * been set together — would have silently flipped to live with no
   * deliberate choice behind it. Defaulting to stubbed is the safe failure;
   * defaulting to live because some set of env vars happens to be present
   * is not, so neither mode is reachable by env-var presence alone anymore.
   * Ground-truth write-capability (real creds, bootstrapped state) is
   * reported separately — see `layers/policy/status.ts` (#11) and the
   * startup log in `src/server.ts` (#14) — rather than folded back into
   * this boolean, so an explicit opt-in always does what it says instead of
   * being silently overridden by a capability snapshot (which would also
   * deadlock a from-scratch first live bootstrap: nothing is "capable" yet
   * on the very first live run, since state doesn't exist until one lands). */
  dryRun: boolean;
  caps: {
    defaultUsd: number;
    hotBalanceUsd: number;
    /** C6: the bookkeeping USD amount one confirmed Ledger press unlocks
     * from a float's locked reserve tranche -- see `layers/custody/`. */
    reserveUnlockUsd: number;
  };
  /** #17: real HBAR bootstrap funds new accounts with, kept low so a demo
   * run costs a fraction of an HBAR instead of several. See
   * `layers/policy/bootstrap.ts` for how these get spent. */
  funding: {
    treasuryInitialHbar: number;
    agentInitialHbar: number;
  };
  /** Which config layers have every relevant env var present — informational
   * (`float_status`'s summary, `layers/perception/tools.ts`'s gate on
   * `configured.graph`) only. As of #14 this no longer feeds `dryRun`:
   * `configured.hedera` in particular requires `HEDERA_TREASURY_ID`/`_KEY`/
   * `HEDERA_TOPIC_ID`, which the policy layer never sets as env vars, so it
   * reads false in normal operation even once real writes are live — see
   * `layers/policy/status.ts` for the ground-truth version of this signal. */
  configured: Record<LayerName, boolean>;
};

const DEFAULT_CAP_USD = 50;
const DEFAULT_HOT_BALANCE_CAP_USD = 200;
// #17: was 3-5 HBAR each (six minted accounts x ~3 HBAR was the largest
// single line item in the project's testnet burn). The treasury only needs
// to cover the demo's actual transfers; a spender only ever pays its own
// transaction fees (transfers move treasury -> counterparty via an approved
// allowance, never out of the spender's own balance).
const DEFAULT_TREASURY_INITIAL_HBAR = 0.5;
const DEFAULT_AGENT_INITIAL_HBAR = 0.05;
const DEFAULT_RESERVE_UNLOCK_USD = 50;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): FloatConfig {
  const parsed = envSchema.parse(env);

  const configured: Record<LayerName, boolean> = {
    graph: !!parsed.GRAPH_API_KEY,
    hedera: !!(
      parsed.HEDERA_OPERATOR_ID &&
      parsed.HEDERA_OPERATOR_KEY &&
      parsed.HEDERA_TREASURY_ID &&
      parsed.HEDERA_TREASURY_KEY &&
      parsed.HEDERA_TOPIC_ID
    ),
    privy: !!(
      parsed.PRIVY_APP_ID &&
      parsed.PRIVY_APP_SECRET &&
      parsed.PRIVY_WALLET_ID &&
      parsed.PRIVY_WALLET_ADDRESS &&
      parsed.PRIVY_AUTHORIZATION_KEY
    ),
    ledger: !!parsed.LEDGER_CLI_BIN,
  };

  // `#14`: no inference from `configured` here — see the `dryRun` doc comment
  // on FloatConfig above for why. An explicit DRY_RUN always wins outright;
  // otherwise FLOAT_LIVE=1 is the one alternate opt-in; anything else stubs.
  const dryRun = parsed.DRY_RUN !== undefined ? parsed.DRY_RUN : !parsed.FLOAT_LIVE;

  return {
    raw: parsed,
    dryRun,
    caps: {
      defaultUsd: parsed.FLOAT_CAP_DEFAULT_USD ?? DEFAULT_CAP_USD,
      hotBalanceUsd: parsed.FLOAT_CAP_HOT_BALANCE_USD ?? DEFAULT_HOT_BALANCE_CAP_USD,
      reserveUnlockUsd: parsed.FLOAT_RESERVE_UNLOCK_USD ?? DEFAULT_RESERVE_UNLOCK_USD,
    },
    funding: {
      treasuryInitialHbar: parsed.FLOAT_TREASURY_INITIAL_HBAR ?? DEFAULT_TREASURY_INITIAL_HBAR,
      agentInitialHbar: parsed.FLOAT_AGENT_INITIAL_HBAR ?? DEFAULT_AGENT_INITIAL_HBAR,
    },
    configured,
  };
}
