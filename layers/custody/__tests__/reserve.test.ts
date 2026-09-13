import { describe, it, expect, beforeEach } from 'vitest';
import { loadConfig } from '../../../src/config.js';
import { getReserve, unlockReserve } from '../reserve.js';
import { resetStateForTests } from '../state.js';

describe('reserve tranche bookkeeping', () => {
  beforeEach(() => resetStateForTests());

  it('starts locked with the configured hot-balance cap and nothing unlocked', () => {
    const config = loadConfig({ FLOAT_CAP_HOT_BALANCE_USD: '200' });
    expect(getReserve(config)).toEqual({ lockedUsd: 200, unlockedUsd: 0, history: [] });
  });

  it('unlocks the configured per-press amount and records the Sepolia tx it was authorized by', () => {
    const config = loadConfig({ FLOAT_CAP_HOT_BALANCE_USD: '200', FLOAT_RESERVE_UNLOCK_USD: '50' });
    const reserve = unlockReserve(config, '0xsepoliatx1');
    expect(reserve.unlockedUsd).toBe(50);
    expect(reserve.history).toHaveLength(1);
    expect(reserve.history[0]).toMatchObject({ amountUsd: 50, sepoliaTxHash: '0xsepoliatx1' });
  });

  it('never unlocks past the locked tranche total, however many presses land', () => {
    const config = loadConfig({ FLOAT_CAP_HOT_BALANCE_USD: '60', FLOAT_RESERVE_UNLOCK_USD: '50' });
    unlockReserve(config, '0x1');
    const second = unlockReserve(config, '0x2');
    expect(second.unlockedUsd).toBe(60); // capped at lockedUsd, not 100
    expect(second.history).toHaveLength(2);
    expect(second.history[1].amountUsd).toBe(10); // only the remaining room
  });
});
