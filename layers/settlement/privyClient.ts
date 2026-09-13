// Thin wrapper around @privy-io/node so the hot wallet is always a Privy
// server wallet, never a raw Arc private key in config (C5's hard rule).
// `@privy-io/server-auth` is deprecated; the current SDK is `@privy-io/node`,
// with viem integration living at `@privy-io/node/viem` (confirmed against
// Privy's docs 2026-09-13, since the ticket flagged the import path
// unverified).

import { PrivyClient } from '@privy-io/node';
import type { AuthorizationContext } from '@privy-io/node';
import type { FloatConfig } from '../../src/config.js';

const WALLET_AUTH_PREFIX = 'wallet-auth:';

/** Privy's key-generation tooling tags a freshly generated authorization
 * private key with a `wallet-auth:` prefix; the wire format `AuthorizationContext`
 * expects is bare base64-encoded PKCS8 with no headers, so the prefix (when
 * present) is stripped before use. */
export function normalizeAuthorizationKey(raw: string): string {
  return raw.startsWith(WALLET_AUTH_PREFIX) ? raw.slice(WALLET_AUTH_PREFIX.length) : raw;
}

export function buildPrivyClient(config: FloatConfig): PrivyClient {
  return new PrivyClient({
    appId: config.raw.PRIVY_APP_ID as string,
    appSecret: config.raw.PRIVY_APP_SECRET as string,
  });
}

export function buildAuthorizationContext(config: FloatConfig): AuthorizationContext {
  return {
    authorization_private_keys: [normalizeAuthorizationKey(config.raw.PRIVY_AUTHORIZATION_KEY as string)],
  };
}
