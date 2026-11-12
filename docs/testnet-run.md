# Testnet run

Run on 2026-11-10T10:12:16.006Z by `node scripts/testnet-e2e.mjs`. Every step links to its transaction on NearBlocks.

- Rajista Pay contract: [`pay.rajistapay-demo.testnet`](https://testnet.nearblocks.io/address/pay.rajistapay-demo.testnet)
- Test USDC (6 decimals): `usdc.rajistapay-demo.testnet`
- Shop `shop.rajistapay-demo.testnet`, customer `customer.rajistapay-demo.testnet`
- Router `router.rajistapay-demo.testnet`: plays the part of `intents.near`, which is the sender when NEAR Intents 1Click delivers USDC with `customRecipientMsg`. NEAR Intents has no testnet, so the real cross-chain payment is on mainnet (see the README).

| Step | Transaction | Contract events |
|---|---|---|
| deploy Rajista Pay | [7QpCcuMg](https://testnet.nearblocks.io/txns/7QpCcuMgs7FcHpmTUnXi67zFuqM9eVt4qcJXjxsFjy6L) |  |
| init Rajista Pay (router = stand-in for intents.near) | [GvkbZ7qH](https://testnet.nearblocks.io/txns/GvkbZ7qHEeRCAryBPe9wtEhbjNTy9ATbPgx42MimMg5s) |  |
| customer mints 40 test USDC | [9YPEwVmU](https://testnet.nearblocks.io/txns/9YPEwVmUjWqwGQfvRSUa7WpF32UVF7jRmQ3HJihZsb5d) |  |
| router mints 40 test USDC | [6YwYJ1rN](https://testnet.nearblocks.io/txns/6YwYJ1rNNufXZ1ct8jM6QhKc1rJn8EKnAkFY87CmcD3u) |  |
| shop prepays 0.05 NEAR of invoice storage | [9wULjjnm](https://testnet.nearblocks.io/txns/9wULjjnmn6BDPN4pX5zrUKaVT38kCFy1Jqmjp2Hoxs3d) |  |
| shop adds a till key (create/void invoices only) | [H2ZoX3QP](https://testnet.nearblocks.io/txns/H2ZoX3QPqMziFXVS514G1wnaqBH7fB6XBEXvjGK4f7oH) |  |
| till issues KANO-mwaj4oe6-A: 12.50 USDC, no wallet prompt | [8rmJ6gmM](https://testnet.nearblocks.io/txns/8rmJ6gmMLDNoaY46b7tVpwcYnA8s6nJNaSHo5NjKTRcA) | `invoice_created {"id":"KANO-mwaj4oe6-A","shop":"shop.rajistapay-demo.testnet","amount":"12500000"}` |
| wallet pays 10.00 (short) → refunded | [G477Z468](https://testnet.nearblocks.io/txns/G477Z468meMXzAVCoDfrAikC7p2rqY4RfHdQjCfcPGGD) | `payment_rejected {"id":"KANO-mwaj4oe6-A","payer":"customer.rajistapay-demo.testnet","amount":"10000000","reason":"short payment"}` |
| wallet pays 13.00 → paid, 0.50 change returned | [F4SmVhUR](https://testnet.nearblocks.io/txns/F4SmVhURQZWz8tgwnkvefm3LArfXvX4zEdTJ9giBQC8q) | `invoice_paid {"id":"KANO-mwaj4oe6-A","shop":"shop.rajistapay-demo.testnet","payer":"customer.rajistapay-demo.testnet","amount":"12500000","refunded":"500000","extra":"0","late":false}` |
| wallet pays the same invoice again → refunded | [2XMvF81E](https://testnet.nearblocks.io/txns/2XMvF81E52LZz1kouy25R1sjVGVwkFRdCMQwZJ3qCtPz) | `payment_rejected {"id":"KANO-mwaj4oe6-A","payer":"customer.rajistapay-demo.testnet","amount":"12500000","reason":"already paid"}` |
| wallet pays an unknown invoice → refunded | [HvyHpbaW](https://testnet.nearblocks.io/txns/HvyHpbaWvB12hYmbXPPSzrvMnVaxNjqC1Qw33hyQ6ivj) | `payment_rejected {"id":"KANO-mwaj4oe6-nope","payer":"customer.rajistapay-demo.testnet","amount":"5000000","reason":"unknown invoice"}` |
| till issues KANO-mwaj4oe6-V | [6ifLzu9H](https://testnet.nearblocks.io/txns/6ifLzu9HnzNFF7siCJ3soSNu3A3bXud5cT7pDMthcxWC) | `invoice_created {"id":"KANO-mwaj4oe6-V","shop":"shop.rajistapay-demo.testnet","amount":"3000000"}` |
| till voids KANO-mwaj4oe6-V | [13J6HwUJ](https://testnet.nearblocks.io/txns/13J6HwUJ3iYfkwQP1uewyckTSRNJbba9GdfHs832xoFH) | `invoice_voided {"id":"KANO-mwaj4oe6-V"}` |
| wallet pays the voided invoice → refunded | [HeQzcdYh](https://testnet.nearblocks.io/txns/HeQzcdYh5Mw6T44EKBSpF5AqFLwWaFeZHa8QCPNxyJhB) | `payment_rejected {"id":"KANO-mwaj4oe6-V","payer":"customer.rajistapay-demo.testnet","amount":"3000000","reason":"invoice voided"}` |
| till issues KANO-mwaj4oe6-E, due in 15 s | [5EW8nveE](https://testnet.nearblocks.io/txns/5EW8nveEZmjQqqxJ7cb3Pvk6rqrAEB74g8yFxxWgaxyL) | `invoice_created {"id":"KANO-mwaj4oe6-E","shop":"shop.rajistapay-demo.testnet","amount":"2000000"}` |
| wallet pays after the due time → refunded | [CCf2ogDu](https://testnet.nearblocks.io/txns/CCf2ogDu37yqctvc7rvvoMva4ZtgKSmKND8NG9HYmWdR) | `payment_rejected {"id":"KANO-mwaj4oe6-E","payer":"customer.rajistapay-demo.testnet","amount":"2000000","reason":"invoice expired"}` |
| till issues KANO-mwaj4oe6-B: 7.25 USDC | [GmfDLzok](https://testnet.nearblocks.io/txns/GmfDLzokVskedVra8ca5FpQgkAG2Bd7kdpEzFep62W5x) | `invoice_created {"id":"KANO-mwaj4oe6-B","shop":"shop.rajistapay-demo.testnet","amount":"7250000"}` |
| router delivers 7.25 → paid | [FZhB9gkq](https://testnet.nearblocks.io/txns/FZhB9gkqyJ6qqLW7j8S2KdNnuiZhsJMGpDFDjYgueDDV) | `invoice_paid {"id":"KANO-mwaj4oe6-B","shop":"shop.rajistapay-demo.testnet","payer":"router.rajistapay-demo.testnet","amount":"7250000","refunded":"0","extra":"0","late":false}` |
| router delivers 7.25 again → held for the shop as extra | [BDzPhzU6](https://testnet.nearblocks.io/txns/BDzPhzU62kDkvv3oRuVijjrFv4BgRCFR2hpAxZNLo3Z7) | `payment_held {"id":"KANO-mwaj4oe6-B","shop":"shop.rajistapay-demo.testnet","amount":"7250000","reason":"already paid"}` |
| till issues KANO-mwaj4oe6-L, due in 15 s | [HRcu54e7](https://testnet.nearblocks.io/txns/HRcu54e7SQnKomxW6715cmaSm6E2gZFwmRxA8c66RLCd) | `invoice_created {"id":"KANO-mwaj4oe6-L","shop":"shop.rajistapay-demo.testnet","amount":"1000000"}` |
| router delivers after the due time → paid, marked late | [C4bpRMZB](https://testnet.nearblocks.io/txns/C4bpRMZB9uiTy2ezc9xKSFp3CG1c8PaKZmCw3qw73zqP) | `invoice_paid {"id":"KANO-mwaj4oe6-L","shop":"shop.rajistapay-demo.testnet","payer":"router.rajistapay-demo.testnet","amount":"1000000","refunded":"0","extra":"0","late":true}` |
| router delivers to an id that never existed → unclaimed | [HKfdH3Zk](https://testnet.nearblocks.io/txns/HKfdH3ZkkXDce1NxAH54kR4MFviauGmCxQMZVNkCsYSr) | `payment_unclaimed {"id":"KANO-mwaj4oe6-ghost","amount":"500000"}` |
| owner returns the unclaimed 0.50 | [DtKihDge](https://testnet.nearblocks.io/txns/DtKihDgeK2JCvsPDtXRgyT6zGErWaq2o9CXr5E9EYQCj) | `unclaimed_returned {"to":"router.rajistapay-demo.testnet","amount":"500000","reason":"demo: payer proved origin tx"}` |
| shop withdraws its USDC | [SaWE79yL](https://testnet.nearblocks.io/txns/SaWE79yLVuarFvCLjZL3NTMTG5yFBvh7oa2HzTzVMVw) | `withdrawn {"shop":"shop.rajistapay-demo.testnet","amount":"28000000"}` |

## Checks

- PASS: till key issued invoices with no NEAR attached
- PASS: wallet: short payment refunded in full
- PASS: wallet: paid exactly 12.50 (13.00 sent, 0.50 returned)
- PASS: wallet: double, unknown, voided and late payments all refunded
- PASS: voided invoice stays void
- PASS: router: first payment settled the invoice
- PASS: router: second payment held as extra 7.25, not sent back
- PASS: router: late payment settled and marked late
- PASS: router: nothing was ever returned to the router
- PASS: owner returned exactly the unclaimed 0.50
- PASS: shop credited 12.50 + 7.25 + 7.25 + 1.00 = 28.00
- PASS: shop received all of it on withdraw
