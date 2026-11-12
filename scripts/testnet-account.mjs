// Creates a funded .testnet account through the public testnet faucet helper.
// The key stays on this machine in .keys/ (gitignored). Testnet only.
import { KeyPair } from "near-api-js";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

const name = process.argv[2];
if (!name || !name.endsWith(".testnet")) {
  console.error("usage: node scripts/testnet-account.mjs <name>.testnet");
  process.exit(1);
}
const file = `.keys/${name}.json`;
if (existsSync(file)) {
  console.error(`${file} already exists`);
  process.exit(1);
}

const kp = KeyPair.fromRandom("ed25519");
const res = await fetch("https://helper.nearprotocol.com/account", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ newAccountId: name, newAccountPublicKey: kp.getPublicKey().toString() }),
});
const text = await res.text();
console.log(res.status, text.slice(0, 300));
if (!res.ok) process.exit(1);

mkdirSync(".keys", { recursive: true });
writeFileSync(file, JSON.stringify({ account_id: name, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }, null, 2));
console.log("saved", file);
