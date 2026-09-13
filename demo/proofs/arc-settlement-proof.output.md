# Arc settlement rail proof -- recorded 2026-09-13T14:17:57.231Z

```
proof: wallet 0xB74B9BF4E861FE9Bb9cf2c55a6E6d2eb16073914 balance = 19.999559 USDC

--- 1. no_signal_cited (uncited transfer) ---
{"denied":true,"reason":"no_signal_cited","detail":"signal_ref \"sig_never_existed\" does not resolve to a known perception-layer query result"}

--- R6 evidence: policy engine on Arc (see verdict in the file header) ---
proof: attaching policy xnkr40kxabkizgluydabfqic (ALLOW <= 50 USDC) and attempting a trivially compliant 0.1 USDC transfer...
{"denied":true,"reason":"provider_policy_denied","detail":"Privy 400: {\"error\":\"RPC request denied due to policy violation\",\"code\":\"policy_violation\"}"}
proof: CONFIRMED -- Privy denied a compliant, well-under-cap transfer. The policy engine does not discriminate on Arc.
proof: detaching the policy permanently (per the R6 fallback, the wallet carries no Privy policy)...

--- 2. ceiling_exceeded (application-level float cap, no Privy policy involved) ---
{"denied":true,"reason":"ceiling_exceeded","detail":"requested 51 USDC exceeds the 50 USDC per-transfer float cap"}

--- 3. real settlement (signal-cited, in-cap, in-float) ---
{"ok":true,"data":{"txHash":"0x2e643427ba53017e05bcb5555ba6da5466f1fef96adafe465e1612b3332ef94c","explorerUrl":"https://testnet.arcscan.app/tx/0x2e643427ba53017e05bcb5555ba6da5466f1fef96adafe465e1612b3332ef94c","to":"0xB74B9BF4E861FE9Bb9cf2c55a6E6d2eb16073914","amount":"0.5","signalRef":"sig_1_mtzwf8pw","signalDigest":"08ade9369960ecf0bad9646d3e004fdc753f5c48b9067432cee90cdc6f4a80a7"},"provenance":{"source":"privy","queriedAt":"2026-09-13T14:17:56.829Z"}}

--- 4. awaiting_device (over-float: requesting more than current balance) ---
{"denied":true,"reason":"awaiting_device","detail":"requested 20.999559 USDC exceeds the hot wallet's float (19.999559 USDC available) -- awaiting treasury replenishment via C6"}
```
