// Rajista Pay server: a Cloudflare Worker in front of the static app.
// It never holds money or keys. It asks NEAR Intents 1Click for quotes that pay into the invoice
// contract, keeps each invoice's receipt (only after its hash matches the one on chain), and
// remembers which deposit addresses belong to which invoice so the shop can see where money came from.

import { NETWORKS, PAY_OPTIONS, ADDRESS_PATTERNS, INVOICE_ID } from "../app/src/config.js";
import { getInvoice, sha256b64 } from "../app/src/chain.js";

const ONECLICK = "https://1click.chaindefuser.com/v0";
const MAX_RECEIPT = 4096;
const MAX_QUOTES_PER_INVOICE = 30;

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...extra } });
const fail = (message, status = 400) => json({ error: message }, status);

function network(id) {
  const n = NETWORKS[id];
  if (!n) throw Object.assign(new Error("unknown network"), { status: 400 });
  return n;
}

async function oneclick(env, path, init = {}) {
  const headers = { "content-type": "application/json", ...(env.ONECLICK_API_KEY ? { "x-api-key": env.ONECLICK_API_KEY } : {}) };
  const res = await fetch(`${ONECLICK}${path}`, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

// 1Click errors are for developers; say what the customer can do instead.
function plainQuoteError(message, option) {
  const m = /at least (\d+)/i.exec(message ?? "");
  if (m) {
    const decimals = option.chain === "bsc" ? 18 : 6;
    const min = Number(m[1]) / 10 ** decimals;
    return `${option.name} ${option.symbol} needs at least $${Math.ceil(min)} per payment right now. Pick another network.`;
  }
  if (/liquidity|no quotes|not found/i.test(message ?? "")) return `${option.name} ${option.symbol} is not available at the moment. Pick another network.`;
  return `${option.name} ${option.symbol} could not be quoted just now. Try again or pick another network.`;
}

async function openInvoice(n, id) {
  if (!INVOICE_ID.test(id ?? "")) throw Object.assign(new Error("bad invoice id"), { status: 400 });
  let inv;
  try {
    inv = await getInvoice(n, id, true);
  } catch (e) {
    if (/does not exist|CodeDoesNotExist|UnknownAccount/i.test(e.message)) inv = null;
    else throw Object.assign(new Error("Could not reach NEAR. Try again."), { status: 503 });
  }
  if (!inv) throw Object.assign(new Error("No such invoice on this network."), { status: 404 });
  return inv;
}

async function quote(req, env) {
  const { net: netId, id, asset, refundTo, dry } = await req.json();
  const n = network(netId);
  if (!n.intents) return fail("Cross-chain payment is only on the live network. On the test network, pay with a NEAR wallet.");
  const option = PAY_OPTIONS.find(o => o.asset === asset);
  if (!option) return fail("unsupported token");
  if (!dry && !ADDRESS_PATTERNS[option.chain].test((refundTo ?? "").trim())) {
    return fail(`That does not look like a ${option.name} address. Use the address you are paying from, so any refund comes back to you.`);
  }
  const inv = await openInvoice(n, id);
  if (inv.status !== "Open") return fail(inv.status === "Paid" ? "This invoice is already paid." : "This invoice was cancelled by the shop.", 409);
  const now = Date.now();
  const due = Number(inv.due_ms);
  if (due && due < now + 60_000) return fail("This invoice has expired. Ask the shop for a new one.", 409);

  let count = 0;
  if (!dry) {
    count = Number((await env.PAY.get(`qc:${n.id}:${id}`)) ?? 0);
    if (count >= MAX_QUOTES_PER_INVOICE) return fail("Too many payment attempts on this invoice. Ask the shop for a new one.", 429);
  }

  const deadline = new Date(Math.min(due || Infinity, now + 30 * 60_000)).toISOString();
  const body = {
    dry: Boolean(dry),
    swapType: "EXACT_OUTPUT",
    slippageTolerance: 100,
    originAsset: option.asset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: n.usdcAsset,
    amount: inv.amount,
    refundTo: dry ? refundPlaceholder(option.chain) : refundTo.trim(),
    refundType: "ORIGIN_CHAIN",
    recipient: n.contract,
    recipientType: "DESTINATION_CHAIN",
    customRecipientMsg: id,
    deadline,
    referral: "rajista",
  };
  const r = await oneclick(env, "/quote", { method: "POST", body: JSON.stringify(body) });
  if (!r.ok) return json({ error: plainQuoteError(r.body.message, option), detail: r.body.message ?? null }, 422);
  const q = r.body.quote;
  // The invoice id must survive into the quote, or the money would reach the contract unlabelled.
  if (r.body.quoteRequest?.customRecipientMsg !== id || r.body.quoteRequest?.recipient !== n.contract) {
    return fail("Quote did not keep the invoice reference; not using it.", 502);
  }
  const out = {
    chain: option.name, symbol: option.symbol,
    amountIn: q.amountIn, amountInFormatted: q.amountInFormatted, minAmountIn: q.minAmountIn,
    amountOutFormatted: q.amountOutFormatted, timeEstimate: q.timeEstimate,
    depositAddress: q.depositAddress ?? null, depositMemo: q.depositMemo ?? null, deadline: q.deadline ?? deadline,
  };
  if (!dry) {
    const key = `q:${n.id}:${id}`;
    const list = JSON.parse((await env.PAY.get(key)) ?? "[]");
    list.push({ depositAddress: q.depositAddress, depositMemo: q.depositMemo ?? null, chain: option.name, symbol: option.symbol, amountIn: q.amountInFormatted, at: now, correlationId: r.body.correlationId, signature: r.body.signature });
    await env.PAY.put(key, JSON.stringify(list));
    await env.PAY.put(`qc:${n.id}:${id}`, String(count + 1));
    await env.PAY.put(`d:${q.depositAddress}`, JSON.stringify({ net: n.id, id }));
  }
  return json(out);
}

// Dry quotes need a syntactically valid refund address; nothing is ever sent to it.
function refundPlaceholder(chain) {
  return {
    sol: "So11111111111111111111111111111111111111112",
    tron: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
    near: "intents.near",
  }[chain] ?? "0x000000000000000000000000000000000000dEaD";
}

function statusView(b) {
  const d = b.swapDetails ?? {};
  return {
    status: b.status, updatedAt: b.updatedAt,
    amountInFormatted: d.amountInFormatted ?? null, amountOutFormatted: d.amountOutFormatted ?? null,
    depositedAmountFormatted: d.depositedAmountFormatted ?? null,
    refundedAmountFormatted: d.refundedAmountFormatted ?? null, refundReason: d.refundReason ?? null,
    originTx: d.originChainTxHashes ?? [], destinationTx: d.destinationChainTxHashes ?? [], nearTx: d.nearTxHashes ?? [],
  };
}

async function status(url, env) {
  const depositAddress = url.searchParams.get("depositAddress") ?? "";
  if (!(await env.PAY.get(`d:${depositAddress}`))) return fail("unknown deposit address", 404);
  const memo = url.searchParams.get("depositMemo");
  const qs = new URLSearchParams({ depositAddress, ...(memo ? { depositMemo: memo } : {}) });
  const r = await oneclick(env, `/status?${qs}`);
  if (!r.ok) return fail(r.body.message ?? "status unavailable", r.status);
  return json(statusView(r.body));
}

async function submit(req, env) {
  const { depositAddress, txHash, memo } = await req.json();
  if (!(await env.PAY.get(`d:${depositAddress}`))) return fail("unknown deposit address", 404);
  if (!/^[0-9A-Za-z]{20,120}$/.test(txHash ?? "")) return fail("That does not look like a transaction hash.");
  const r = await oneclick(env, "/deposit/submit", { method: "POST", body: JSON.stringify({ depositAddress, txHash, ...(memo ? { memo } : {}) }) });
  if (!r.ok) return fail(r.body.message ?? "could not submit", r.status);
  return json(statusView(r.body));
}

async function putReceipt(req, env) {
  const { net: netId, id, receipt } = await req.json();
  const n = network(netId);
  if (typeof receipt !== "string" || receipt.length > MAX_RECEIPT) return fail("receipt missing or too large");
  try { JSON.parse(receipt); } catch { return fail("receipt must be JSON"); }
  const inv = await openInvoice(n, id);
  if ((await sha256b64(receipt)) !== inv.items_hash) return fail("receipt does not match the invoice on chain", 409);
  await env.PAY.put(`r:${n.id}:${id}`, receipt);
  return json({ ok: true });
}

async function getReceipts(url, env) {
  const n = network(url.searchParams.get("net"));
  const ids = (url.searchParams.get("ids") ?? "").split(",").filter(id => INVOICE_ID.test(id)).slice(0, 100);
  const out = {};
  await Promise.all(ids.map(async id => {
    const r = await env.PAY.get(`r:${n.id}:${id}`);
    if (r) out[id] = r;
  }));
  return json(out);
}

async function payments(url, env) {
  const n = network(url.searchParams.get("net"));
  const id = url.searchParams.get("id") ?? "";
  if (!INVOICE_ID.test(id)) return fail("bad invoice id");
  const list = JSON.parse((await env.PAY.get(`q:${n.id}:${id}`)) ?? "[]");
  return json(list.map(({ signature, correlationId, ...rest }) => rest));
}

async function rate() {
  const cache = caches.default;
  const key = new Request("https://rate.cache/usd-ngn");
  const hit = await cache.match(key);
  if (hit) return hit;
  const r = await fetch("https://open.er-api.com/v6/latest/USD");
  const b = await r.json();
  const res = json({ ngnPerUsd: b.rates?.NGN ?? null, source: "open.er-api.com", at: b.time_last_update_utc ?? null }, 200, { "cache-control": "public, max-age=3600" });
  await cache.put(key, res.clone());
  return res;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      if (p === "/api/quote" && req.method === "POST") return await quote(req, env);
      if (p === "/api/status") return await status(url, env);
      if (p === "/api/submit" && req.method === "POST") return await submit(req, env);
      if (p === "/api/receipt" && req.method === "POST") return await putReceipt(req, env);
      if (p === "/api/receipts") return await getReceipts(url, env);
      if (p === "/api/payments") return await payments(url, env);
      if (p === "/api/rate") return await rate();
      if (p.startsWith("/api/")) return fail("not found", 404);
      // Short pay links: /p/<id> (live) and /t/<id> (test network) open the pay page.
      if (/^\/[pt]\/[A-Za-z0-9_-]{1,64}$/.test(p)) {
        return env.ASSETS.fetch(new Request(new URL("/pay", url), req));
      }
      return env.ASSETS.fetch(req);
    } catch (e) {
      return fail(e.status ? e.message : "Something went wrong. Try again.", e.status ?? 500);
    }
  },
};
