# Arc settlement rail proof -- recorded 2026-09-13T14:04:34.253Z

```
proof: wallet 0xB74B9BF4E861FE9Bb9cf2c55a6E6d2eb16073914 balance = 0 USDC

--- 1. no_signal_cited (uncited transfer) ---
{"denied":true,"reason":"no_signal_cited","detail":"signal_ref \"sig_never_existed\" does not resolve to a known perception-layer query result"}

proof: balance is 0 -- fund 0xB74B9BF4E861FE9Bb9cf2c55a6E6d2eb16073914 via https://faucet.circle.com to run the funded checks.
--- 2. awaiting_device (over-float; 0 balance means everything over-floats) ---
{"denied":true,"reason":"awaiting_device","detail":"requested 0.01 USDC exceeds the hot wallet's float (0 USDC available) -- awaiting treasury replenishment via C6"}
proof: over-cap and successful-transfer checks require funding -- stopping here.
```
