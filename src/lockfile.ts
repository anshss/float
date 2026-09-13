// Startup lockfile verification hook. C1 ships a no-op stub; C2 fills in real
// pin-checking against layers/perception/deployments.lock.json. The contract
// this hook must honor either way: refuse to serve unpinned perception data.

export type LockfileStatus = {
  verified: boolean;
  hash: string | null;
  detail: string;
};

export function verifyLockfile(): LockfileStatus {
  return {
    verified: false,
    hash: null,
    detail: 'no-op stub (C1) — C2 pins deployments.lock.json and fills this in',
  };
}
