# Testnet run

Run on 2026-11-11T10:58:14.928Z by `node scripts/testnet-e2e.mjs`. Every step links to its transaction on NearBlocks.

- Rajista Pay contract: [`pay.rajistapay-demo.testnet`](https://testnet.nearblocks.io/address/pay.rajistapay-demo.testnet)
- Test USDC (6 decimals): `usdc.rajistapay-demo.testnet`
- Shop `shop.rajistapay-demo.testnet`, customer `customer.rajistapay-demo.testnet`
- Router `router.rajistapay-demo.testnet`: plays the part of `intents.near`, which is the sender when NEAR Intents 1Click delivers USDC with `customRecipientMsg`. NEAR Intents has no testnet, so the real cross-chain payment is on mainnet (see the README).

| Step | Transaction | Contract events |
|---|---|---|
| deploy Rajista Pay | [7fam6cgj](https://testnet.nearblocks.io/txns/7fam6cgjX5tf7jwHzndEEc43BpYmisFDspr2uEvbUtFF) |  |
| init Rajista Pay (router = stand-in for intents.near) | [CWhvJxAX](https://testnet.nearblocks.io/txns/CWhvJxAXbsiQ8sD3WLm361sPZXbdTuFQyffBtMmkQB5F) |  |
| customer mints 40 test USDC | [Fr8otUyz](https://testnet.nearblocks.io/txns/Fr8otUyzM241s24mUSoXk2HZgupcepHS5FeWQfPJh6fp) |  |
| router mints 40 test USDC | [8eYD9eQw](https://testnet.nearblocks.io/txns/8eYD9eQw8XPobN5PEcQFaELHofTm2v63se1LScfXzw5B) |  |
| shop prepays 0.05 NEAR of invoice storage | [8B7EGhdF](https://testnet.nearblocks.io/txns/8B7EGhdFJaPg5j1c99J9j8nj1RTVV2rDiNL5VZmGNvCV) |  |
| shop adds a till key (create/void invoices only) | [68fpTJkT](https://testnet.nearblocks.io/txns/68fpTJkT6vxX5HP5c2xhwRLmoxbPtAumTovWVccwQ3o8) |  |
| till issues KANO-mwc07pyr-A: 12.50 USDC, no wallet prompt | [DyKoLL8V](https://testnet.nearblocks.io/txns/DyKoLL8VAGmR663fovrkeNmnk3uEsPJmxhdpHTUHfigG) | `invoice_created {"id":"KANO-mwc07pyr-A","shop":"shop.rajistapay-demo.testnet","amount":"12500000"}` |
| wallet pays 10.00 (short) → refunded | [DajAKtfW](https://testnet.nearblocks.io/txns/DajAKtfWusLEjCbk1PHjBDWdg8jDEzcoqXJUdYq8Y9ca) | `payment_rejected {"id":"KANO-mwc07pyr-A","payer":"customer.rajistapay-demo.testnet","amount":"10000000","reason":"short payment"}` |
| wallet pays 13.00 → paid, 0.50 change returned | [23UUcy3f](https://testnet.nearblocks.io/txns/23UUcy3fsF3NFrAPtPPPyhf7md7asVrsLRyzEucuGg9g) | `invoice_paid {"id":"KANO-mwc07pyr-A","shop":"shop.rajistapay-demo.testnet","payer":"customer.rajistapay-demo.testnet","amount":"12500000","refunded":"500000","extra":"0","late":false}` |
| wallet pays the same invoice again → refunded | [6VKFsWJ4](https://testnet.nearblocks.io/txns/6VKFsWJ43Jr7vsUwiSXdQCkQn7Giiimmy6Z5RJdfbrCN) | `payment_rejected {"id":"KANO-mwc07pyr-A","payer":"customer.rajistapay-demo.testnet","amount":"12500000","reason":"already paid"}` |
| wallet pays an unknown invoice → refunded | [BFigdrUU](https://testnet.nearblocks.io/txns/BFigdrUUVJwAXSW4LsQBujfCbFnHGDh7ZtGupFWpk7qt) | `payment_rejected {"id":"KANO-mwc07pyr-nope","payer":"customer.rajistapay-demo.testnet","amount":"5000000","reason":"unknown invoice"}` |
| till issues KANO-mwc07pyr-V | [GSCGrdiF](https://testnet.nearblocks.io/txns/GSCGrdiFKTjvVoQaYo3g2n3JYQ3WtX8vtukkcayncu1) | `invoice_created {"id":"KANO-mwc07pyr-V","shop":"shop.rajistapay-demo.testnet","amount":"3000000"}` |
| till voids KANO-mwc07pyr-V | [GM8PPmWe](https://testnet.nearblocks.io/txns/GM8PPmWepmWuAc7EgvvbWvSfVZeDcDuDwVGYZVrtyrz3) | `invoice_voided {"id":"KANO-mwc07pyr-V"}` |
| wallet pays the voided invoice → refunded | [EPDQDcNq](https://testnet.nearblocks.io/txns/EPDQDcNqBR6djb7E4K9PFmhkJJR4KCvGyUm9bwo7GYRL) | `payment_rejected {"id":"KANO-mwc07pyr-V","payer":"customer.rajistapay-demo.testnet","amount":"3000000","reason":"invoice voided"}` |
| till issues KANO-mwc07pyr-E, due in 15 s | [HimjCJwS](https://testnet.nearblocks.io/txns/HimjCJwSng5D3sLdaUd2QF7FrLbribD5d8VopFWgbiz6) | `invoice_created {"id":"KANO-mwc07pyr-E","shop":"shop.rajistapay-demo.testnet","amount":"2000000"}` |
| wallet pays after the due time → refunded | [HxF9qohr](https://testnet.nearblocks.io/txns/HxF9qohrKjZAW92bcFFGj73io3HBgdQEzsFP323bjsQA) | `payment_rejected {"id":"KANO-mwc07pyr-E","payer":"customer.rajistapay-demo.testnet","amount":"2000000","reason":"invoice expired"}` |
| till issues KANO-mwc07pyr-B: 7.25 USDC | [9hzjXamB](https://testnet.nearblocks.io/txns/9hzjXamBWv3LFy1g3y2P5MgqHGsdyAT6h2r4eWoMfnNH) | `invoice_created {"id":"KANO-mwc07pyr-B","shop":"shop.rajistapay-demo.testnet","amount":"7250000"}` |
| router delivers 7.25 → paid | [Bk5FXhjN](https://testnet.nearblocks.io/txns/Bk5FXhjNCCxSppkxbCpdD6gFWXcQwhC3t1EfpYeMt9bZ) | `invoice_paid {"id":"KANO-mwc07pyr-B","shop":"shop.rajistapay-demo.testnet","payer":"router.rajistapay-demo.testnet","amount":"7250000","refunded":"0","extra":"0","late":false}` |
| router delivers 7.25 again → held for the shop as extra | [5n3gi6df](https://testnet.nearblocks.io/txns/5n3gi6dfngqmLNGwX4ZW299Rwe7LSVA2ScwT1B4WYDkR) | `payment_held {"id":"KANO-mwc07pyr-B","shop":"shop.rajistapay-demo.testnet","amount":"7250000","reason":"already paid"}` |
| till issues KANO-mwc07pyr-L, due in 15 s | [EjGVPizJ](https://testnet.nearblocks.io/txns/EjGVPizJpxqeDdFDPBB1LL9EZVyrZXmarbJbESrN2dvr) | `invoice_created {"id":"KANO-mwc07pyr-L","shop":"shop.rajistapay-demo.testnet","amount":"1000000"}` |
| router delivers after the due time → paid, marked late | [AUkseduQ](https://testnet.nearblocks.io/txns/AUkseduQZBpAPL3Jp9CyFndMDbmeL6ExNDkbnZNx5CZL) | `invoice_paid {"id":"KANO-mwc07pyr-L","shop":"shop.rajistapay-demo.testnet","payer":"router.rajistapay-demo.testnet","amount":"1000000","refunded":"0","extra":"0","late":true}` |
| router delivers to an id that never existed → unclaimed | [2DyjBpKj](https://testnet.nearblocks.io/txns/2DyjBpKji9Yt1JxbhavxBFPuUMWgW67YF9AryBiYFYFS) | `payment_unclaimed {"id":"KANO-mwc07pyr-ghost","amount":"500000"}` |
| owner returns the unclaimed 0.50 | [4boCn45i](https://testnet.nearblocks.io/txns/4boCn45iwZnP1kMg8WqSJGFntE7rAqoYQX2wtZkS4Lf1) | `unclaimed_returned {"to":"router.rajistapay-demo.testnet","amount":"500000","reason":"demo: payer proved origin tx"}` |
| shop withdraws its USDC | [BK8q79ah](https://testnet.nearblocks.io/txns/BK8q79ahsTbmzHXjFDufT1rqtq3g7amQLCBFuGbYFZAM) | `withdrawn {"shop":"shop.rajistapay-demo.testnet","amount":"28000000"}` |

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
