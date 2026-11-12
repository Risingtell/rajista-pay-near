# Testnet run

Run on 2026-11-10T09:02:44.360Z by `scripts/testnet-e2e.mjs`. Every line links to the transaction on NearBlocks.

- Rajista Pay contract: `pay.rajistapay-demo.testnet`
- Test USDC (6 decimals): `usdc.rajistapay-demo.testnet`
- Shop: `shop.rajistapay-demo.testnet`, customer: `customer.rajistapay-demo.testnet`

| Step | Transaction | Events |
|---|---|---|
| deploy + init test USDC | [HssGcRL5…](https://testnet.nearblocks.io/txns/HssGcRL5VsPqWibqe9D2TBXQSANmzohdZk4qBRYhceUZ) |  |
| deploy + init Rajista Pay | [4TLmpszh…](https://testnet.nearblocks.io/txns/4TLmpszhpz5EETHh9h3BmsUEMMYy6YknJxtcd2y3iJBk) |  |
| register pay on test USDC | [FJgai7xb…](https://testnet.nearblocks.io/txns/FJgai7xbNXDvjzNaZNa9VeSF56FiGdfQNWF3y3LU2Dns) |  |
| register shop on test USDC | [6ynees8u…](https://testnet.nearblocks.io/txns/6ynees8uyDqP9GYsb56Y5iqVxPUpr4Y1XT26iB27V56r) |  |
| customer mints 60 test USDC | [tunBxQYV…](https://testnet.nearblocks.io/txns/tunBxQYV5BtJ3hLD2j7xwggreXvLmmdNeEMMG5zxHux) |  |
| shop issues KANO-mwagm2hs-1 for 12.50 USDC | [85gYM28f…](https://testnet.nearblocks.io/txns/85gYM28fR98EyShfjMvvYbjUPYFBVN79WTCFtRARsfwS) | `invoice_created {"id":"KANO-mwagm2hs-1","shop":"shop.rajistapay-demo.testnet","amount":"12500000"}` |
| customer underpays 10.00 → refunded | [2hQrHjQG…](https://testnet.nearblocks.io/txns/2hQrHjQGHGrtzTWoJ8ixwmJ6U7xBUNLYHczQfQF2kzxp) | `payment_rejected {"id":"KANO-mwagm2hs-1","payer":"customer.rajistapay-demo.testnet","amount":"10000000","reason":"short payment"}` |
| customer pays 13.00 → invoice paid, 0.50 change returned | [FzPaECMj…](https://testnet.nearblocks.io/txns/FzPaECMjSfL7na5GtxF9SGX3zoVgwz9BeuhSdzn4k6JQ) | `invoice_paid {"id":"KANO-mwagm2hs-1","shop":"shop.rajistapay-demo.testnet","payer":"customer.rajistapay-demo.testnet","amount":"12500000","refunded":"500000"}` |
| customer pays the same invoice again → refunded | [9xg57Fdp…](https://testnet.nearblocks.io/txns/9xg57FdpjaQxmuPUr71MdXA9i9Ptjb5RZLe8sCBZ8d3m) | `payment_rejected {"id":"KANO-mwagm2hs-1","payer":"customer.rajistapay-demo.testnet","amount":"12500000","reason":"already paid"}` |
| payment to an unknown invoice → refunded | [4xNv4Vq8…](https://testnet.nearblocks.io/txns/4xNv4Vq8JzWCgsPb9mHwEsy8kWtw11GpBp4wzjfsj8Pm) | `payment_rejected {"id":"KANO-mwagm2hs-nope","payer":"customer.rajistapay-demo.testnet","amount":"5000000","reason":"unknown invoice"}` |
| shop issues KANO-mwagm2hs-2 | [D2t8KJt3…](https://testnet.nearblocks.io/txns/D2t8KJt3UvkyHxqrAfhTBnXM4RRfRUzmTget6MH5LpQ8) | `invoice_created {"id":"KANO-mwagm2hs-2","shop":"shop.rajistapay-demo.testnet","amount":"3000000"}` |
| shop voids KANO-mwagm2hs-2 | [6yYi1Kas…](https://testnet.nearblocks.io/txns/6yYi1Kasa2YjkFGvMQyQ2x5UDVW8mSxGSNP4yvUfUV4H) | `invoice_voided {"id":"KANO-mwagm2hs-2"}` |
| payment to a voided invoice → refunded | [DszPH2FH…](https://testnet.nearblocks.io/txns/DszPH2FHtWMEpg4Py5GwXBRSrggdust7TzFoCKCFxJfv) | `payment_rejected {"id":"KANO-mwagm2hs-2","payer":"customer.rajistapay-demo.testnet","amount":"3000000","reason":"invoice voided"}` |
| shop issues KANO-mwagm2hs-3, due in 15 s | [BTZ7KS7w…](https://testnet.nearblocks.io/txns/BTZ7KS7wwYStFr4rY5HBhMU8Q1U3RJyk7c9p68S6uZMe) | `invoice_created {"id":"KANO-mwagm2hs-3","shop":"shop.rajistapay-demo.testnet","amount":"2000000"}` |
| payment after the due time → refunded | [CAhk2sRP…](https://testnet.nearblocks.io/txns/CAhk2sRPKRcD2JhHE6S7tkyQXqwqiWwrMb4iBZFiWg5U) | `payment_rejected {"id":"KANO-mwagm2hs-3","payer":"customer.rajistapay-demo.testnet","amount":"2000000","reason":"invoice expired"}` |
| shop withdraws its USDC | [AE15ycvx…](https://testnet.nearblocks.io/txns/AE15ycvx1ME8YVCchrEh3WMPUvLzfsxsnPynLCSGQYkK) | `withdrawn {"shop":"shop.rajistapay-demo.testnet","amount":"12500000"}` |

## Checks

- PASS: underpayment fully refunded
- PASS: paid exactly 12.50 (13.00 sent, 0.50 returned)
- PASS: all rejected payments refunded
- PASS: invoice is Paid by the customer
- PASS: shop was credited 12.50 in the contract
- PASS: shop received the USDC on withdraw
- PASS: contract shop balance is zero after withdraw

Customer balance: 60.00 before, 47.50 after (one 12.50 payment). Shop received 12.50 USDC.
