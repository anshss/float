// The float/treasury reserve model. No bridge is in scope: a confirmed
// Sepolia treasury movement never lands as USDC on Arc or HBAR on Hedera --
// there is no path for it to. What it DOES do is unlock a fixed USD amount
// from a locked reserve tranche that policy otherwise refuses to release.
// The hardware authorization is real, the treasury movement is real, the
// unlock itself is bookkeeping. Never call this an unlock that "bridges"
// funds -- it authorizes a release of Float's own accounting, nothing more.

import type { FloatConfig } from '../../src/config.js';
import { loadState, saveState, type ReserveLedger } from './state.js';

export function getReserve(config: FloatConfig): ReserveLedger {
  const state = loadState();
  return state.reserve ?? { lockedUsd: config.caps.hotBalanceUsd, unlockedUsd: 0, history: [] };
}

/** Called only from a confirmed replenishment (`replenish.ts`, itself only
 * reachable once `pending.ts` has observed a real device-signed, broadcast
 * Sepolia transaction). Unlocks at most `config.caps.reserveUnlockUsd` per
 * press, capped at the tranche's total `lockedUsd`. */
export function unlockReserve(config: FloatConfig, sepoliaTxHash: string): ReserveLedger {
  const state = loadState();
  const reserve = state.reserve ?? { lockedUsd: config.caps.hotBalanceUsd, unlockedUsd: 0, history: [] };
  const room = Math.max(reserve.lockedUsd - reserve.unlockedUsd, 0);
  const amountUsd = Math.min(config.caps.reserveUnlockUsd, room);
  reserve.unlockedUsd += amountUsd;
  reserve.history.push({ ts: new Date().toISOString(), amountUsd, sepoliaTxHash });
  state.reserve = reserve;
  saveState(state);
  return reserve;
}
