# C6 custody proof

```

--- wallet-cli account discover ethereum:sepolia (real device) ---
{
  "denied": true,
  "reason": "deployment_unavailable",
  "detail": "wallet-cli account discover did not succeed: {\"type\":\"device-state\",\"command\":\"account discover\",\"network\":\"ethereum:sepolia\",\"state\":{\"code\":\"awaiting_approval\",\"reason\":\"unlock\"},\"message\":\"Ledger is locked. Enter your PIN on the device.\"}"
}

--- wallet-cli balances (real device, read-only) ---
{
  "ok": true,
  "data": {
    "status": "success",
    "command": "balances",
    "network": "ethereum:sepolia",
    "account": "js:2:ethereum_sepolia:0x58a8679318eaFBCbB28dC5e619886462f2A1872f:",
    "balances": [
      {
        "asset": "ethereum_sepolia",
        "amount": "0.02 ETH"
      }
    ],
    "timestamp": "2026-09-13T15:21:17.065Z"
  }
}

--- wallet-cli operations (real device, read-only) ---
{
  "ok": true,
  "data": {
    "status": "success",
    "command": "operations",
    "network": "ethereum:sepolia",
    "account": "account:1:address:ethereum:sepolia:0x58a8679318eaFBCbB28dC5e619886462f2A1872f:m/44h/60h/0h/0/0",
    "operations": [
      {
        "accountId": "account:1:address:ethereum:sepolia:0x58a8679318eaFBCbB28dC5e619886462f2A1872f:m/44h/60h/0h/0/0",
        "asset": "ethereum_sepolia",
        "type": "IN",
        "value": "0.02 ETH",
        "fee": "0.00005212 ETH",
        "senders": [
          "0xc5fe05AE628fb86F922d6ca35585F7bDF6C86F96"
        ],
        "recipients": [
          "0x58a8679318eaFBCbB28dC5e619886462f2A1872f"
        ],
        "blockHeight": 11696551,
        "date": "2026-09-13T14:44:12.000Z",
        "hash": "0xab52b66503c5dc0d2c9acab7c22251bb2cfde81e8d40a407300d834bb14d1cb3"
      }
    ],
    "timestamp": "2026-09-13T15:21:20.418Z"
  }
}

--- refusal preview (DRY_RUN, real tx construction, no device touch) ---
{
  "denied": true,
  "reason": "awaiting_device",
  "detail": "PREVIEW ONLY, no device touched -- would authorize 0.001 ETH from 0x1234567890123456789012345678901234567890 to funding address 0x8A0be873Ff74657c9F0a3460B4596213083EEE39 (nonce 0, est. fee 0.00002676150036 ETH, chain sepolia/11155111). Set DRY_RUN=0 (or FLOAT_LIVE=1) and LEDGER_CLI_BIN to authorize for real."
}

--- discoverSepoliaAccounts with no device configured ---
{
  "denied": true,
  "reason": "deployment_unavailable",
  "detail": "LEDGER_CLI_BIN not set -- wallet-cli is not configured"
}

--- getBalances with no device configured ---
{
  "denied": true,
  "reason": "deployment_unavailable",
  "detail": "LEDGER_CLI_BIN not set -- wallet-cli is not configured"
}

--- requestReplenishment with no device configured ---
{
  "denied": true,
  "reason": "deployment_unavailable",
  "detail": "could not resolve the treasury address via wallet-cli account discover"
}

--- GRANT_SIGNER=ledger with no device configured (grant_budget stays callable) ---
{
  "denied": true,
  "reason": "awaiting_device",
  "detail": "GRANT_SIGNER=ledger: grant for \"demo-child\" (3 HBAR) needs an on-device Clear Signing press -- set LEDGER_CLI_BIN to authorize"
}
```
