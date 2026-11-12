# Rajista Pay on NEAR

A Nigerian shop rings up a sale in naira and shows a QR code. The customer pays with USDC or USDT
from whichever chain they already hold it on: Solana, Base, Arbitrum, Ethereum, Tron, BNB Chain,
Polygon, Optimism, Avalanche or NEAR. NEAR Intents converts it, and an invoice contract on NEAR
decides whether the payment settles the invoice. The shop receives USDC on NEAR and exports a CSV
for its books.

**Track:** Real-World Money · **Live app:** [rajista-pay.rajista.workers.dev](https://rajista-pay.rajista.workers.dev) · **Contract:** [`rajistapay.near`](https://nearblocks.io/address/rajistapay.near) (mainnet), `pay.rajistapay-demo.testnet` (testnet)

## A real sale on mainnet

12 November 2026, Rising Technology, Kano. The till sold one item, a customer paid from Base, and
the contract settled it. Receipt: [/p/RISINGTE-MWDBSJXB3U2](https://rajista-pay.rajista.workers.dev/p/RISINGTE-MWDBSJXB3U2).

| Step | Proof |
|---|---|
| Till issues the invoice: 1 × Kuli Kuli, ₦1,140 at ₦1,349.82 = **0.85 USDC**, no wallet prompt | `create_invoice` from `risingtell.near` with its till key |
| Customer sends 0.858761 USDC **on Base** to the quote's deposit address | [Base tx 0x511df49d…7803](https://basescan.org/tx/0x511df49db1a0cd35f02d8c91d394e2b87f666e613fd7fd18946ad0ca8aac7803) |
| NEAR Intents swaps exactly 0.85 USDC to NEAR and returns the unused 0.006188 to the customer | 1Click status `SUCCESS` |
| `intents.near` delivers with `ft_transfer_call`; the contract receives `msg: "RISINGTE-MWDBSJXB3U2"` and settles it | [NEAR tx Afo9C89H…](https://nearblocks.io/txns/Afo9C89HutErBxJgqU4N9NrhMqEAV5BZLnxNSFddqzWE) |
| Invoice `Paid`, payer `intents.near`, not late, nothing held; shop balance 0.85 USDC | `get_invoice`, `get_balance` on `rajistapay.near` |
| Shop withdraws: 0.85 USDC lands in `risingtell.near`, contract balance back to 0 | [NEAR tx 5YcSu3tj…](https://nearblocks.io/txns/5YcSu3tjYWPHKmKuPuBcE6p7p1GtU9EmBW3Pp3XmDT9b) |

**Check it yourself** without an explorer or a key: `npm install && npm run verify` re-reads every
claim above from a public NEAR RPC (10 checks, exit code 0 when all pass).

`rajistapay.near` has no access keys: its code can never be changed, and nobody can move a shop's
money except the shop. The build is reproducible: `bash scripts/build.sh` on a fresh clone gives a
byte-identical `res/rajista_pay.wasm` (SHA-256 `e390f9e0…0b8f`), the same code NearBlocks shows on
`rajistapay.near` (code hash `GKKmNPXpSrEUDaNjGMcza2zCNhB5LDeSZt1JdnYjbuHG` is that SHA-256 in base58).

## Try it in two minutes (free, test network)

1. Open the till on the test network: `/shop?net=testnet`, connect a NEAR testnet wallet, press
   **Set up this till** (one approval).
2. Add an item in naira and press **Create invoice**. No wallet prompt: the till key signs it.
3. Open the pay link on a phone or second tab, pick **USDC on NEAR**, press **Get 20 test USDC**,
   then **Pay**. The till turns green within a few seconds.

Every step of the same flow, including every rejection path, is on testnet with transaction links:
[docs/testnet-run.md](docs/testnet-run.md).

## How it works

```
 Till (browser)                    Invoice contract (NEAR)                 Customer
 ─────────────                     ───────────────────────                 ────────
 items in ₦ + rate ─ till key ──▶ create_invoice(id, USDC amount,
                                   due time, SHA-256 of the items)
 QR code of /p/<id>  ─────────────────────────────────────────────────▶ opens pay page
                                                                         picks e.g. USDT on Tron
                   worker ── 1Click quote: EXACT_OUTPUT to the contract,
                             customRecipientMsg = invoice id ─────────▶ deposit address
                                                                         sends on Tron
 NEAR Intents ── intents.near ft_transfer_call(USDC, msg = id) ──▶ ft_on_transfer
                                   settles the invoice, credits the shop
 till sees Paid ◀──────────────────
 withdraw ──────────────────────▶ ft_transfer to the shop's wallet
```

- **Exact amount.** The quote is `EXACT_OUTPUT`: the contract receives exactly the invoice amount.
  Anything the customer sends above the quote's input is returned to their own address by NEAR
  Intents after the swap.
- **The invoice id travels with the money.** 1Click's `customRecipientMsg` makes `intents.near`
  deliver with `ft_transfer_call`, so the contract sees the invoice id. The worker refuses any quote
  that does not echo the id and the contract back.
- **Item list cannot change.** The till hashes the receipt (shop name, items, naira total, rate)
  into the invoice. The worker stores a receipt only if its hash matches the chain, and the pay
  page checks the hash again in the customer's browser.
- **Till key.** The shop's wallet signs once to add a function-call key limited to
  `create_invoice` and `void_invoice` on this contract. Invoice storage comes from NEAR the shop
  prepaid, so the till never attaches NEAR and never needs a wallet prompt per sale. The key
  cannot move money.

## The contract decides, not the server

`contract/src/lib.rs` + `json.rs` + `abi.rs`, 36 unit tests (`npm test`, runs in WSL or Linux).

| Payment | From a NEAR wallet | Through NEAR Intents (`intents.near`) |
|---|---|---|
| Open invoice, full amount | Paid; change refunded | Paid; any excess held as `extra` |
| Second payment | Refunded in full | Held as `extra`, shown to the shop as a refund owed |
| Short payment | Refunded in full | Held as `extra`; invoice stays open |
| Cancelled invoice | Refunded in full | Held as `extra` |
| After the due time | Refunded in full | Paid and marked `late` (the quote was issued while it was open) |
| Unknown invoice id | Refunded in full | Held as `unclaimed`; only the owner can return it |
| Any other token | Rejected | Rejected |

Why router payments are never sent back: the NEAR Intents contract
([source](https://github.com/near/intents/blob/main/contracts/defuse/src/contract/tokens/nep141/withdraw.rs))
credits a returned amount to the Intents account that made the withdrawal, not to the customer. So
the contract keeps that money visible on the invoice and on the shop's balance, and the shop, who
has the customer in front of them, refunds it.

Other rules: an invoice is paid once; a paid invoice cannot be cancelled or changed; only the shop
can withdraw its balance (1 yoctoNEAR confirmation, re-credited if the transfer fails); ids are
unique forever; the owner can touch only `unclaimed` money, never a shop's balance. Every state
change emits a NEP-297 event (`standard: "rajista_pay"`).

## What is in the repo

| Path | What |
|---|---|
| `contract/` | Invoice contract (Rust, near-sdk 5.30) |
| `mock-usdc/` | Test USDC for testnet (NEP-141, 6 decimals, anyone can mint up to 100) |
| `res/` | Built wasm (plain MVP wasm; `scripts/build.sh` rebuilds it) |
| `worker/` | Cloudflare Worker: 1Click quotes and status, receipt store, NGN rate |
| `app/` | Landing page, shop till, customer pay page (Vite, NEAR Connect wallets) |
| `scripts/testnet-e2e.mjs` | Deploys to testnet and runs every money path, writes `docs/testnet-run.md` |

The worker holds no keys and no money. It keeps three things in Cloudflare KV: receipts (only
after the hash check), which deposit addresses belong to which invoice, and a per-invoice quote
counter.

## Run it

Prerequisites: Node 20 or later (built with 24), and for the contract Rust stable (built with 1.96)
with the `wasm32-unknown-unknown` target plus binaryen's `wasm-opt` (built with version 130), on
Linux, macOS or WSL.

```bash
npm install
npm test                                 # 36 contract tests (scripts/test.sh)
npm run verify                           # 10 checks of the mainnet proof, from a public RPC
npm run build && npx wrangler dev        # app + API on http://localhost:8787
bash scripts/build.sh                    # rebuild res/*.wasm from source
```

The whole money flow on testnet, with your own free account (the faucet gives it 10 NEAR):

```bash
node scripts/testnet-account.mjs yourname-rp.testnet
TESTNET_ROOT=yourname-rp.testnet node scripts/testnet-e2e.mjs --fresh    # 12 checks, writes docs/testnet-run.md
TESTNET_ROOT=yourname-rp.testnet node scripts/testnet-guards.mjs        # 7 calls the contract must refuse
```

The first deploys test USDC and the invoice contract under your account and runs every payment
path in the table above; each step prints its NearBlocks link. Keys stay in `.keys/` (gitignored).

## Prior work and what is new

Rajista Pay began as a Solana entry, [Risingtell/rajista-pay](https://github.com/Risingtell/rajista-pay):
a USDC till on Solana with an Anchor program. That code is not used here. Everything in this
repository was written for NEAR after 19 October 2026: the invoice contract, the NEAR Intents
cross-chain flow, the till key, the worker and the app. Rajista itself is a point-of-sale app for
Nigerian shops ([www.rajista.com](https://www.rajista.com)); this is its crypto checkout.

My other NEAR Hackathon entry is **AfriRadar on NEAR** (Agent Economy track), an independent project.

## Notes

- NEAR Intents has no testnet, so cross-chain payments run on mainnet only. The testnet run plays
  `intents.near` with a stand-in account to prove the contract side.
- Some routes have temporary minimums set by the network (for example Tron USDT and BNB Chain
  USDT). The pay page asks for a live quote before showing an address and says so plainly when a
  route is not available for that amount.
- The naira rate is the shop's own. The till suggests the market rate, and the shop can change it.

Built by Rising Technology, Jaba, Kano. MIT licence.
