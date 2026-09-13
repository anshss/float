import { describe, it, expect, beforeEach } from 'vitest';
import { startPendingOp, reportPending } from '../pending.js';
import { resetStateForTests } from '../state.js';

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('custody pending-op bookkeeping', () => {
  beforeEach(() => resetStateForTests());

  it('reports idle with nothing in flight', () => {
    expect(reportPending()).toEqual({ ok: true, data: { pending: false } });
  });

  it('returns awaiting_device immediately and never awaits the signing promise', () => {
    let resolveRun!: (v: unknown) => void;
    const started = startPendingOp('replenish', 'authorize 0.01 ETH', () => new Promise((r) => (resolveRun = r)));
    expect(started).toEqual({ denied: true, reason: 'awaiting_device', detail: 'authorize 0.01 ETH' });
    expect(reportPending()).toMatchObject({ denied: true, reason: 'awaiting_device' });
    resolveRun({ done: true }); // avoid an unresolved promise leaking into other tests
  });

  it('a second op cannot start while one is still pending', () => {
    startPendingOp('replenish', 'authorize 0.01 ETH', () => new Promise(() => {}));
    const second = startPendingOp('grant', 'approve grant', () => Promise.resolve({}));
    expect(second).toMatchObject({ denied: true, reason: 'awaiting_device' });
    expect((second as { detail: string }).detail).toMatch(/already awaiting a device press/);
  });

  it('reports the real result once the background press resolves -- confirm_pending reports, never bypasses', async () => {
    startPendingOp('replenish', 'authorize 0.01 ETH', () => Promise.resolve({ sepoliaTxHash: '0xabc' }));
    await tick();
    const result = reportPending();
    expect(result).toEqual({ ok: true, data: { sepoliaTxHash: '0xabc' } });
    // one-shot: a second read after the result was consumed is idle again.
    expect(reportPending()).toEqual({ ok: true, data: { pending: false } });
  });

  it('surfaces a device rejection as awaiting_device with the rejection reason, and clears so a retry can start', async () => {
    startPendingOp('grant', 'approve grant', () => Promise.reject(new Error('device declined the request')));
    await tick();
    const result = reportPending();
    expect(result).toMatchObject({ denied: true, reason: 'awaiting_device' });
    expect((result as { detail: string }).detail).toContain('device declined the request');
    expect(reportPending()).toEqual({ ok: true, data: { pending: false } });
  });
});
