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
  PRIVY_APP_ID: z.string().min(1).optional(),
  PRIVY_APP_SECRET: z.string().min(1).optional(),
  PRIVY_WALLET_ID: z.string().min(1).optional(),
  LEDGER_CLI_BIN: z.string().min(1).optional(),
  FLOAT_CAP_DEFAULT_USD: z.coerce.number().positive().optional(),
  FLOAT_CAP_HOT_BALANCE_USD: z.coerce.number().positive().optional(),
  DRY_RUN: z
    .string()
    .optional()
    .transform((v) => v === undefined ? undefined : v === '1' || v.toLowerCase() === 'true'),
});

export type RawEnv = z.infer<typeof envSchema>;

export type LayerName = 'graph' | 'hedera' | 'privy' | 'ledger';

export type FloatConfig = {
  raw: RawEnv;
  /** DRY_RUN defaults to true whenever a chain-writing layer's creds are
   * absent, so demo/dev never accidentally sends a real transaction. */
  dryRun: boolean;
  caps: {
    defaultUsd: number;
    hotBalanceUsd: number;
  };
  /** Which config layers are fully present, for `float_status` and for tools
   * to check before doing real work. */
  configured: Record<LayerName, boolean>;
};

const DEFAULT_CAP_USD = 50;
const DEFAULT_HOT_BALANCE_CAP_USD = 200;

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
    privy: !!(parsed.PRIVY_APP_ID && parsed.PRIVY_APP_SECRET && parsed.PRIVY_WALLET_ID),
    ledger: !!parsed.LEDGER_CLI_BIN,
  };

  const anyWriteLayerMissing = !configured.hedera || !configured.privy || !configured.ledger;
  const dryRun = parsed.DRY_RUN ?? anyWriteLayerMissing;

  return {
    raw: parsed,
    dryRun,
    caps: {
      defaultUsd: parsed.FLOAT_CAP_DEFAULT_USD ?? DEFAULT_CAP_USD,
      hotBalanceUsd: parsed.FLOAT_CAP_HOT_BALANCE_USD ?? DEFAULT_HOT_BALANCE_CAP_USD,
    },
    configured,
  };
}
