// The till key: a NEAR access key that lives on this device and can only call create_invoice and
// void_invoice on the Rajista Pay contract. It cannot move money. The shop's wallet adds it once,
// then every sale is issued with no wallet prompt.
import { Account, JsonRpcProvider, KeyPair } from "near-api-js";
import { accessKey } from "./chain.js";

const slot = (n, shop) => `rajista-pay:till:${n.id}:${shop}`;

function load(n, shop) {
  try {
    return localStorage.getItem(slot(n, shop));
  } catch {
    return null;
  }
}

export function newTillKey() {
  return KeyPair.fromRandom("ed25519");
}

export function saveTillKey(n, shop, kp) {
  localStorage.setItem(slot(n, shop), kp.toString());
}

export function forgetTillKey(n, shop) {
  try { localStorage.removeItem(slot(n, shop)); } catch { /* storage blocked */ }
}

// The key on this device, and whether the chain still has it with enough allowance left.
export async function tillStatus(n, shop) {
  const secret = load(n, shop);
  if (!secret) return { ready: false, reason: "none" };
  const kp = KeyPair.fromString(secret);
  const pub = kp.getPublicKey().toString();
  const onChain = await accessKey(n, shop, pub);
  if (!onChain) return { ready: false, reason: "removed", publicKey: pub };
  const fc = onChain.permission?.FunctionCall;
  if (!fc || fc.receiver_id !== n.contract) return { ready: false, reason: "wrong", publicKey: pub };
  const allowance = fc.allowance == null ? null : BigInt(fc.allowance);
  if (allowance !== null && allowance < 10n ** 22n) return { ready: false, reason: "allowance", publicKey: pub };
  return { ready: true, publicKey: pub, allowance };
}

export async function tillCall(n, shop, methodName, args) {
  const secret = load(n, shop);
  if (!secret) throw new Error("This device has no till key yet.");
  const account = new Account(shop, new JsonRpcProvider({ url: n.rpc }), secret);
  return account.callFunctionRaw({ contractId: n.contract, methodName, args, deposit: 0n, gas: 30n * 10n ** 12n });
}
