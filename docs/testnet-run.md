# Testnet run

Run on 2026-11-10T09:37:17.613Z by `node scripts/testnet-e2e.mjs`. Every step links to its transaction on NearBlocks.

- Rajista Pay contract: [`pay.rajistapay-demo.testnet`](https://testnet.nearblocks.io/address/pay.rajistapay-demo.testnet)
- Test USDC (6 decimals): `usdc.rajistapay-demo.testnet`
- Shop `shop.rajistapay-demo.testnet`, customer `customer.rajistapay-demo.testnet`
- Router `router.rajistapay-demo.testnet`: plays the part of `intents.near`, which is the sender when NEAR Intents 1Click delivers USDC with `customRecipientMsg`. NEAR Intents has no testnet, so the real cross-chain payment is on mainnet (see the README).

| Step | Transaction | Contract events |
|---|---|---|
| deploy Rajista Pay | [3gwM8u29](https://testnet.nearblocks.io/txns/3gwM8u29weVRkUra4R48c1eXevf7wtvcLkZBZceXZkKs) |  |
| init Rajista Pay (router = stand-in for intents.near) | [HVPZwXbm](https://testnet.nearblocks.io/txns/HVPZwXbmLvGQMyPUW8tKpsbHixFAULbxsW2Y5o616FqA) |  |
| customer mints 40 test USDC | [5BvoXs9i](https://testnet.nearblocks.io/txns/5BvoXs9iwggBSH2Jgn3pHwe2sW4Sux8Cs1KFZEDJzB4o) |  |
| router mints 40 test USDC | [5YTMd1tx](https://testnet.nearblocks.io/txns/5YTMd1txvHCupVz9qo5jPNSepgCb5SjyS55ugAJeThjd) |  |
| shop prepays 0.05 NEAR of invoice storage | [Dahqpi1k](https://testnet.nearblocks.io/txns/Dahqpi1kKaPNS8Y23dsvvcKykkxZj9sqMyBkmZWsJmGL) |  |
| shop adds a till key (create/void invoices only) | [FW9ELqqb](https://testnet.nearblocks.io/txns/FW9ELqqbZYE163JySMK8X6jsUcg5TRAgLcWBv2UA1xyP) |  |
| till issues KANO-mwahvo6x-A: 12.50 USDC, no wallet prompt | [9e7wkLwe](https://testnet.nearblocks.io/txns/9e7wkLweLLFpvyrrKhtUjJqcERsQDdzaeZcesMeh4p9u) | `invoice_created {"id":"KANO-mwahvo6x-A","shop":"shop.rajistapay-demo.testnet","amount":"12500000"}` |
| wallet pays 10.00 (short) → refunded | [8Coth4yV](https://testnet.nearblocks.io/txns/8Coth4yVhhw5hSRwgvDqzyNqvjuFTWWmftPK7QDqgfkt) | `payment_rejected {"id":"KANO-mwahvo6x-A","payer":"customer.rajistapay-demo.testnet","amount":"10000000","reason":"short payment"}` |
| wallet pays 13.00 → paid, 0.50 change returned | [DHyqQEF8](https://testnet.nearblocks.io/txns/DHyqQEF8rmkdgnafGH5yZU2u3SRa9p8RTM1u3CSeKDnc) | `invoice_paid {"id":"KANO-mwahvo6x-A","shop":"shop.rajistapay-demo.testnet","payer":"customer.rajistapay-demo.testnet","amount":"12500000","refunded":"500000","extra":"0","late":false}` |
| wallet pays the same invoice again → refunded | [91r83t1c](https://testnet.nearblocks.io/txns/91r83t1cgyJAshMt3qtCLvGjsD3qwYsVrJDkmB1CqMqK) | `payment_rejected {"id":"KANO-mwahvo6x-A","payer":"customer.rajistapay-demo.testnet","amount":"12500000","reason":"already paid"}` |
| wallet pays an unknown invoice → refunded | [HkbcAk9T](https://testnet.nearblocks.io/txns/HkbcAk9TuY7x9B6j7LZx7n22RYhiMRXbwkEhhEjqe1i6) | `payment_rejected {"id":"KANO-mwahvo6x-nope","payer":"customer.rajistapay-demo.testnet","amount":"5000000","reason":"unknown invoice"}` |
| till issues KANO-mwahvo6x-V | [5hg6f8Yc](https://testnet.nearblocks.io/txns/5hg6f8YcZ39bYLcdCZyS3HWcBk3eCtYVHZ3QUF77CYZL) | `invoice_created {"id":"KANO-mwahvo6x-V","shop":"shop.rajistapay-demo.testnet","amount":"3000000"}` |
| till voids KANO-mwahvo6x-V | [Hoh82twg](https://testnet.nearblocks.io/txns/Hoh82twgVynRxQnm69PfnarssT3ghFytSPoiWHe58rgV) | `invoice_voided {"id":"KANO-mwahvo6x-V"}` |
| wallet pays the voided invoice → refunded | [AGDqkk1Q](https://testnet.nearblocks.io/txns/AGDqkk1QQUcpPmRiy1NwxufQycbXi5W7gaqvdsDA96yw) | `payment_rejected {"id":"KANO-mwahvo6x-V","payer":"customer.rajistapay-demo.testnet","amount":"3000000","reason":"invoice voided"}` |
| till issues KANO-mwahvo6x-E, due in 15 s | [5kzojm9a](https://testnet.nearblocks.io/txns/5kzojm9aHRVn9GEX3D4MeeoWqpEKbfbsBapJ3HUDoKBS) | `invoice_created {"id":"KANO-mwahvo6x-E","shop":"shop.rajistapay-demo.testnet","amount":"2000000"}` |
| wallet pays after the due time → refunded | [EzoqH9V4](https://testnet.nearblocks.io/txns/EzoqH9V4JQrzEyeHyqey8Y9NUroG3T7wPpsMU8Zx5yHy) | `payment_rejected {"id":"KANO-mwahvo6x-E","payer":"customer.rajistapay-demo.testnet","amount":"2000000","reason":"invoice expired"}` |
| till issues KANO-mwahvo6x-B: 7.25 USDC | [2FyYE4Vb](https://testnet.nearblocks.io/txns/2FyYE4VbYyoqrFqdZwY6r8KUVc5rXPyq1tKTHtV5jryF) | `invoice_created {"id":"KANO-mwahvo6x-B","shop":"shop.rajistapay-demo.testnet","amount":"7250000"}` |
| router delivers 7.25 → paid | [6HBByAPR](https://testnet.nearblocks.io/txns/6HBByAPRirs3NJKFWKvjMvBZ4P4DiyuBeRnemSABMRYa) | `invoice_paid {"id":"KANO-mwahvo6x-B","shop":"shop.rajistapay-demo.testnet","payer":"router.rajistapay-demo.testnet","amount":"7250000","refunded":"0","extra":"0","late":false}` |
| router delivers 7.25 again → held for the shop as extra | [3Jz3j2VW](https://testnet.nearblocks.io/txns/3Jz3j2VW9ixQ4kwXnafQX7XRniFq3G3HGoDxwRedYWzS) | `payment_held {"id":"KANO-mwahvo6x-B","shop":"shop.rajistapay-demo.testnet","amount":"7250000","reason":"already paid"}` |
| till issues KANO-mwahvo6x-L, due in 15 s | [D4g4ihBa](https://testnet.nearblocks.io/txns/D4g4ihBaZjVmBwjNk4Dd4VMUm6ny51mAMqt3eHBGN2ed) | `invoice_created {"id":"KANO-mwahvo6x-L","shop":"shop.rajistapay-demo.testnet","amount":"1000000"}` |
| router delivers after the due time → paid, marked late | [DUTaE89C](https://testnet.nearblocks.io/txns/DUTaE89CUG6Reuh98EQny2HkycB5HMDzTQYz1VggofYQ) | `invoice_paid {"id":"KANO-mwahvo6x-L","shop":"shop.rajistapay-demo.testnet","payer":"router.rajistapay-demo.testnet","amount":"1000000","refunded":"0","extra":"0","late":true}` |
| router delivers to an id that never existed → unclaimed | [8Y5ye67a](https://testnet.nearblocks.io/txns/8Y5ye67aUas7tgYwnbKd5LgLPshAcDNrsA4Ju2A3qcZp) | `payment_unclaimed {"id":"KANO-mwahvo6x-ghost","amount":"500000"}` |
| owner returns the unclaimed 0.50 | [Co8WX9Ji](https://testnet.nearblocks.io/txns/Co8WX9JidVERbmebayRFftBCudr1WQjCPJ8nVK3Ag3dS) | `unclaimed_returned {"to":"router.rajistapay-demo.testnet","amount":"500000","reason":"demo: payer proved origin tx"}` |
| shop withdraws its USDC | [8UVLs8xp](https://testnet.nearblocks.io/txns/8UVLs8xptgR2QRzLVE2fL44p4M1Bmnuqa1qtWjm13DgQ) | `withdrawn {"shop":"shop.rajistapay-demo.testnet","amount":"28000000"}` |

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
