// Creates a fresh, unconfigured testnet shop account for browser tests of the till setup.
//   node scripts/testnet-shop.mjs <prefix>
import { Account, JsonRpcProvider, nearToYocto } from "near-api-js";
import { readFileSync } from "node:fs";
import { existsSync as keyExists } from "node:fs";
const keyFile = root => {
  const f = `.keys/${root}.json`;
  if (!keyExists(f)) {
    console.error(`No key for ${root}. Create a funded testnet account first:
  node scripts/testnet-account.mjs <name>.testnet
then run this script with TESTNET_ROOT=<name>.testnet`);
    process.exit(2);
  }
  return f;
};

// Your own testnet account: node scripts/testnet-account.mjs <name>.testnet, then TESTNET_ROOT=<name>.testnet
const ROOT = process.env.TESTNET_ROOT ?? "rajistapay-demo.testnet";
const key = JSON.parse(readFileSync(keyFile(ROOT), "utf8"));
const provider = new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" });
const id = `${process.argv[2]}.${ROOT}`;
await new Account(ROOT, provider, key.private_key).createSubAccount({ accountOrPrefix: id, publicKey: key.public_key, nearToTransfer: nearToYocto("0.5") });
const v = await provider.viewAccount({ accountId: ROOT });
console.log("created", id, "root balance", (Number(BigInt(v.amount) / 10n ** 21n) / 1000).toFixed(3), "NEAR");
