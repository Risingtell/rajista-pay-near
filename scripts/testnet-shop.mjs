// Creates a fresh, unconfigured testnet shop account for browser tests of the till setup.
//   node scripts/testnet-shop.mjs <prefix>
import { Account, JsonRpcProvider, nearToYocto } from "near-api-js";
import { readFileSync } from "node:fs";
const ROOT = "rajistapay-demo.testnet";
const key = JSON.parse(readFileSync(`.keys/${ROOT}.json`, "utf8"));
const provider = new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" });
const id = `${process.argv[2]}.${ROOT}`;
await new Account(ROOT, provider, key.private_key).createSubAccount({ accountOrPrefix: id, publicKey: key.public_key, nearToTransfer: nearToYocto("0.5") });
const v = await provider.viewAccount({ accountId: ROOT });
console.log("created", id, "root balance", (Number(BigInt(v.amount) / 10n ** 21n) / 1000).toFixed(3), "NEAR");
