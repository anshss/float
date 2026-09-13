import { describe, it, expect } from 'vitest';
import { hashscanAccountUrl, hashscanTopicUrl, hashscanTransactionUrl } from '../hashscan.js';

describe('hashscan link builders', () => {
  it('builds a testnet transaction url, URL-encoding the @ in a Hedera tx id', () => {
    expect(hashscanTransactionUrl('0.0.123@169999.123456')).toBe(
      'https://hashscan.io/testnet/transaction/0.0.123%40169999.123456',
    );
  });

  it('builds a testnet topic url', () => {
    expect(hashscanTopicUrl('0.0.10524028')).toBe('https://hashscan.io/testnet/topic/0.0.10524028');
  });

  it('builds a testnet account url', () => {
    expect(hashscanAccountUrl('0.0.10524426')).toBe('https://hashscan.io/testnet/account/0.0.10524426');
  });
});
