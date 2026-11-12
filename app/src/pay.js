import { NETWORKS, PAY_OPTIONS, ADDRESS_PATTERNS, INVOICE_ID } from "./config.js";
import { view, viewFresh, getInvoice, sha256b64 } from "./chain.js";
import { connect, currentAccount, send, fnCall, assertOk } from "./wallet.js";
import { $, $$, esc, naira, usdc, when, header, qr, toast, copy, pill, api, accountLink, txLink, short, clean } from "./ui.js";

// /p/<id> = live network, /t/<id> = test network, or /pay?net=..&id=..
const path = /^\/([pt])\/([A-Za-z0-9_-]{1,64})$/.exec(location.pathname);
const qs = new URLSearchParams(location.search);
const n = path ? (path[1] === "p" ? NETWORKS.mainnet : NETWORKS.testnet) : NETWORKS[qs.get("net")] ?? NETWORKS.mainnet;
const id = path ? path[2] : qs.get("id") ?? "";
const saved = `rajista-pay:quote:${n.id}:${id}`;
const store = {
  get: () => { try { return JSON.parse(localStorage.getItem(saved)); } catch { return null; } },
  set: v => { try { localStorage.setItem(saved, JSON.stringify(v)); } catch { /* storage blocked */ } },
  clear: () => { try { localStorage.removeItem(saved); } catch { /* storage blocked */ } },
};

$("#header").innerHTML = header("", n.id);

let inv = null;
let receipt = null;
let verified = false;
let poll = null;

async function load() {
  if (!INVOICE_ID.test(id)) return fatal("This link is not a Rajista Pay invoice.");
  try {
    inv = await getInvoice(n, id, true);
  } catch {
    return fatal("Could not reach NEAR. Check your connection and reload.");
  }
  if (!inv) return fatal(`No invoice ${esc(id)} on the ${n.label.toLowerCase()}.`);
  const r = await api(`/api/receipts?net=${n.id}&ids=${id}`).catch(() => ({}));
  if (r[id]) {
    verified = (await sha256b64(r[id])) === inv.items_hash;
    if (verified) receipt = clean(JSON.parse(r[id]));
  }
  renderInvoice();
  route();
}

function fatal(msg) {
  $("#invoice").innerHTML = `<h2>Invoice not found</h2><p class="muted">${msg}</p>`;
}

const expired = () => inv.status === "Open" && Number(inv.due_ms) && Date.now() > Number(inv.due_ms);

function renderInvoice() {
  const items = receipt?.items ?? [];
  $("#invoice").innerHTML = `
    <div class="row"><div class="grow"><div class="label-up">${esc(receipt?.shop ?? "Shop")}</div><div class="small muted">${accountLink(n, inv.shop)}</div></div>${pill(inv)}</div>
    ${items.length ? `<table class="items">${items.map(i => `<tr><td>${esc(i.qty)} × ${esc(i.name)}</td><td class="num">${naira(i.qty * i.price)}</td></tr>`).join("")}</table>` : ""}
    <div class="row" style="align-items:flex-end;border-top:1.5px solid var(--line);padding-top:14px">
      <div class="grow">${receipt ? `<div class="label-up">Total</div><div style="font-size:22px;font-weight:800">${naira(receipt.total)}</div><div class="small muted">at ₦${esc(receipt.rate)} per USDC</div>` : ""}</div>
      <div style="text-align:right"><div class="label-up">${inv.status === "Paid" ? "Paid" : "To pay"}</div><div class="big">${usdc(inv.amount)}</div><div class="small muted">USDC</div></div>
    </div>
    <div class="small muted">Invoice <span class="mono">${esc(inv.id)}</span> · issued ${when(inv.created_ms)}${Number(inv.due_ms) ? ` · <span id="countdown"></span>` : ""}</div>
    ${receipt ? `<div class="small" style="color:var(--green)">✓ Items match the record on NEAR</div>` : `<div class="small muted">Item list not available; the amount above comes from NEAR.</div>`}
    ${inv.status === "Paid" ? paidBlock() : ""}`;
  tickCountdown();
}

function paidBlock() {
  const via = inv.payer === n.router ? "through NEAR Intents" : `from ${esc(inv.payer)}`;
  return `<div class="note good"><b style="font-size:20px">✓ Paid</b><div class="small">${when(inv.paid_ms)} · ${via}${inv.late ? " · after the due time" : ""}</div></div>
    <div class="row no-print" style="flex-wrap:wrap"><button class="ghost small" onclick="print()">Print receipt</button><a class="btn quiet small" href="${n.explorer}/address/${n.contract}" target="_blank" rel="noopener">Contract on NearBlocks</a></div>
    <div id="pay-links" class="small"></div>`;
}

let countdownTimer = null;
function tickCountdown() {
  clearInterval(countdownTimer);
  const el = $("#countdown");
  if (!el) return;
  const draw = () => {
    const left = Number(inv.due_ms) - Date.now();
    if (inv.status !== "Open") { el.textContent = `due ${when(inv.due_ms)}`; return; }
    if (left <= 0) { el.textContent = "expired"; clearInterval(countdownTimer); if (!store.get()) route(); return; }
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    el.textContent = m > 90 ? `due ${when(inv.due_ms)}` : `${m}:${String(s).padStart(2, "0")} left to pay`;
  };
  draw();
  countdownTimer = setInterval(draw, 1000);
}

function route() {
  clearInterval(poll);
  $("#pay").classList.add("hide");
  $("#progress").classList.add("hide");
  const q = store.get();
  // A payment already sent must be followed to the end, whatever the invoice's state now.
  if (q?.depositAddress) return resume(q);
  if (inv.status === "Paid") return showPaymentLinks();
  if (inv.status === "Void") return note("The shop cancelled this invoice. Ask them for a new one.");
  if (expired()) return note("This invoice has expired. Ask the shop for a new one.");
  showOptions();
}

// A saved deposit address is only shown again while it is still valid, or once money was seen.
async function resume(q) {
  const s = await api(`/api/status?depositAddress=${encodeURIComponent(q.depositAddress)}`).catch(() => null);
  const untouched = !s || s.status === "PENDING_DEPOSIT";
  if (untouched && Date.now() > Date.parse(q.requestDeadline ?? 0)) {
    store.clear();
    if (inv.status === "Open" && !expired()) {
      showOptions();
      $("#opt-panel").innerHTML = `<div class="note">Your previous payment address has expired. Pick a network to get a new one.</div>`;
      return;
    }
    return route();
  }
  showDeposit(q);
}

function note(text) {
  $("#pay").classList.remove("hide");
  $("#pay").innerHTML = `<p class="muted" style="margin:0">${text}</p>`;
}

// -- choose how to pay ---------------------------------------------------------------------

function showOptions() {
  const box = $("#pay");
  box.classList.remove("hide");
  const cross = n.intents
    ? `<div class="label-up">Pay from any of these</div><div class="opts">${PAY_OPTIONS.map((o, i) => `<button class="opt" data-i="${i}"><b>${o.symbol}</b>&nbsp;on ${o.name}</button>`).join("")}</div>`
    : `<div class="note">This is the free test network: pay with test USDC from a NEAR testnet wallet. On the live network, customers pay from Solana, Base, Ethereum, Tron and more.</div>`;
  box.innerHTML = `<h2 style="margin:0">How do you want to pay?</h2>${cross}
    <div class="label-up" style="margin-top:8px">Or from a NEAR wallet</div>
    <button class="opt" id="opt-near" style="width:100%"><b>USDC</b>&nbsp;on NEAR (Meteor, HOT, Intear…)</button>
    <div id="opt-panel"></div>`;
  $$(".opt[data-i]").forEach(b => b.addEventListener("click", () => chooseCross(PAY_OPTIONS[Number(b.dataset.i)], b)));
  $("#opt-near").addEventListener("click", e => chooseNear(e.currentTarget));
}

function mark(btn) {
  $$(".opt").forEach(b => b.classList.toggle("on", b === btn));
}

async function chooseCross(o, btn) {
  mark(btn);
  const panel = $("#opt-panel");
  panel.innerHTML = `<p class="muted"><span class="spinner"></span> Checking ${o.symbol} on ${o.name}…</p>`;
  let est;
  try {
    est = await api("/api/quote", { net: n.id, id, asset: o.asset, dry: true });
  } catch (e) {
    panel.innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
    return;
  }
  panel.innerHTML = `
    <div class="note">You send about <b>${esc(est.amountInFormatted)} ${o.symbol}</b> on ${o.name}. The shop receives exactly ${usdc(inv.amount)} USDC on NEAR. Arrives in about ${Math.max(1, Math.round(est.timeEstimate / 60))} min.</div>
    <div class="field"><label for="refund">Your ${o.name} address (the one you pay from)</label><input id="refund" autocomplete="off" spellcheck="false" placeholder="${o.chain === "sol" ? "e.g. 7xKX…" : o.chain === "tron" ? "T…" : o.chain === "near" ? "you.near" : "0x…"}"><div class="small muted">If anything goes wrong, the money comes back here.</div></div>
    <button class="wide" id="get-address">Get payment address</button>`;
  $("#get-address").addEventListener("click", async e => {
    const btn = e.currentTarget;
    const refundTo = $("#refund").value.trim();
    if (!ADDRESS_PATTERNS[o.chain].test(refundTo)) return toast(`That is not a ${o.name} address`, "bad");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Getting address`;
    try {
      const q = await api("/api/quote", { net: n.id, id, asset: o.asset, refundTo });
      // What the invoice looked like before this payment, to tell its outcome apart from others.
      const saved = { ...q, chainKey: o.chain, refundTo, at: Date.now(), before: { status: inv.status, extra: inv.extra } };
      store.set(saved);
      showDeposit(saved);
    } catch (err) {
      toast(err.message, "bad");
      btn.disabled = false;
      btn.textContent = "Get payment address";
    }
  });
}

// -- send to the deposit address and follow it ----------------------------------------------

async function showDeposit(q) {
  $("#pay").classList.add("hide");
  const box = $("#progress");
  box.classList.remove("hide");
  box.innerHTML = `
    <h2 style="margin:0">Send ${esc(q.symbol)} on ${esc(q.chain)}</h2>
    <div class="steps"><span id="st1" class="on"></span><span id="st2"></span><span id="st3"></span></div>
    <div id="st-text" class="small muted">Waiting for your payment</div>
    <div class="row" style="align-items:flex-start;flex-wrap:wrap">
      <div class="qr" style="width:200px">${await qr(q.depositAddress, 200)}</div>
      <div class="grow stack" style="min-width:220px">
        <div><div class="label-up">Amount</div><div style="font-size:26px;font-weight:800">${esc(q.amountInFormatted)} ${esc(q.symbol)}</div><button class="quiet small" id="cp-amt">Copy amount</button></div>
        <div><div class="label-up">To this ${esc(q.chain)} address</div><div class="mono small">${esc(q.depositAddress)}</div><button class="quiet small" id="cp-addr">Copy address</button></div>
        ${q.depositMemo ? `<div><div class="label-up">Memo (required)</div><div class="mono">${esc(q.depositMemo)}</div></div>` : ""}
      </div>
    </div>
    <div class="note small">Send only ${esc(q.symbol)} on ${esc(q.chain)}. Sending a little more is fine: the extra is returned to ${esc(short(q.refundTo, 8, 6))} after the payment.</div>
    <details class="small"><summary>Already sent? Paste the transaction hash to speed it up</summary>
      <div class="row" style="margin-top:8px"><input id="txh" placeholder="Transaction hash" spellcheck="false"><button class="small" id="txh-go">Send</button></div></details>
    <button class="quiet small" id="change">Pay a different way</button>`;
  $("#cp-amt").onclick = () => copy(q.amountInFormatted);
  $("#cp-addr").onclick = () => copy(q.depositAddress);
  $("#change").onclick = () => { store.clear(); clearInterval(poll); box.classList.add("hide"); showOptions(); };
  $("#txh-go").onclick = async () => {
    try {
      await api("/api/submit", { depositAddress: q.depositAddress, txHash: $("#txh").value.trim(), memo: q.depositMemo ?? undefined });
      toast("Thanks, checking it now");
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  clearInterval(poll);
  const tick = () => follow(q);
  tick();
  poll = setInterval(tick, 5000);
}

const STAGES = {
  PENDING_DEPOSIT: [1, "Waiting for your payment"],
  KNOWN_DEPOSIT_TX: [2, "Payment seen, waiting for confirmations"],
  PROCESSING: [2, "Converting to USDC on NEAR"],
  SUCCESS: [3, "Delivered to the invoice contract"],
  INCOMPLETE_DEPOSIT: [1, "Less than needed arrived. Send the rest, or wait and it is refunded."],
  REFUNDED: [0, "Refunded to your address"],
  FAILED: [0, "The payment failed and will be refunded"],
};

async function follow(q) {
  let s;
  try {
    s = await api(`/api/status?depositAddress=${encodeURIComponent(q.depositAddress)}${q.depositMemo ? `&depositMemo=${encodeURIComponent(q.depositMemo)}` : ""}`);
  } catch {
    return;
  }
  const [stage, text] = STAGES[s.status] ?? [1, s.status];
  ["st1", "st2", "st3"].forEach((k, i) => {
    const el = $(`#${k}`);
    if (!el) return;
    el.className = stage === 0 ? "" : i + 1 < stage ? "ok" : i + 1 === stage ? (stage === 3 ? "ok" : "on") : "";
  });
  const extra = s.refundedAmountFormatted && Number(s.refundedAmountFormatted) > 0 ? ` Returned to you: ${s.refundedAmountFormatted} ${q.symbol}.` : "";
  if ($("#st-text")) $("#st-text").textContent = text + extra;
  if (s.status === "SUCCESS" || s.status === "REFUNDED" || s.status === "FAILED") {
    clearInterval(poll);
    if (s.status === "SUCCESS") return waitForPaid(q);
    store.clear();
  }
}

// 1Click reports SUCCESS when the USDC reaches the contract. Wait until the contract's state shows
// this payment: either it settled the invoice, or it was held for the shop to refund.
async function waitForPaid(q) {
  const before = q.before ?? { status: "Open", extra: "0" };
  let settled = false, held = false;
  for (let i = 0; i < 40 && !settled && !held; i++) {
    inv = await getInvoice(n, id, true).catch(() => inv);
    settled = before.status !== "Paid" && inv.status === "Paid";
    held = BigInt(inv.extra) > BigInt(before.extra ?? 0);
    if (!settled && !held) await new Promise(r => setTimeout(r, 3000));
  }
  store.clear();
  $("#progress").classList.add("hide");
  renderInvoice();
  if (settled) {
    showPaymentLinks();
    if (held && BigInt(inv.extra) - BigInt(before.extra ?? 0) > 0n) note(`You sent more than the invoice. The shop holds the extra ${usdc(BigInt(inv.extra) - BigInt(before.extra ?? 0))} USDC and will refund it.`);
  } else if (held) {
    note(`This invoice was ${before.status === "Paid" ? "already paid" : "closed"} when your payment arrived. The shop holds your ${usdc(BigInt(inv.extra) - BigInt(before.extra ?? 0))} USDC and will refund it; show them this page.`);
  } else {
    note("Your payment was delivered and is being recorded. Refresh in a minute.");
  }
}

async function showPaymentLinks() {
  const el = $("#pay-links");
  if (!el || inv.payer !== n.router) return;
  const list = await api(`/api/payments?net=${n.id}&id=${id}`).catch(() => []);
  const rows = [];
  for (const p of list.slice(-3)) {
    const s = await api(`/api/status?depositAddress=${encodeURIComponent(p.depositAddress)}`).catch(() => null);
    if (s?.status !== "SUCCESS") continue;
    const origin = s.originTx[0];
    const dest = s.destinationTx[0];
    rows.push(`Paid with ${esc(p.symbol)} on ${esc(p.chain)}: ${origin ? `<a href="${esc(origin.explorerUrl)}" target="_blank" rel="noopener">${esc(short(origin.hash))}</a>` : ""}${dest ? ` → ${txLink(n, dest.hash, "NEAR delivery")}` : ""}`);
  }
  el.innerHTML = rows.join("<br>");
}

// -- pay from a NEAR wallet ----------------------------------------------------------------

async function chooseNear(btn) {
  mark(btn);
  const panel = $("#opt-panel");
  let who = await currentAccount(n);
  const draw = async () => {
    if (!who) {
      panel.innerHTML = `<button class="wide" id="near-connect">Connect NEAR wallet</button>`;
      $("#near-connect").onclick = async () => {
        try { who = await connect(n); draw(); } catch (e) { toast(e.message ?? "Wallet did not connect", "bad"); }
      };
      return;
    }
    const bal = BigInt((await viewFresh(n, n.usdc, "ft_balance_of", { account_id: who }).catch(() => "0")) ?? "0");
    const enough = bal >= BigInt(inv.amount);
    panel.innerHTML = `
      <div class="small">Wallet ${accountLink(n, who)} has <b>${usdc(bal)} USDC</b>.</div>
      ${!enough && !n.intents ? `<button class="ghost wide" id="near-mint">Get 20 test USDC (free)</button>` : ""}
      ${!enough && n.intents ? `<div class="note">Not enough USDC on NEAR. Pick one of the other networks above instead.</div>` : ""}
      <button class="wide" id="near-pay" ${enough ? "" : "disabled"}>Pay ${usdc(inv.amount)} USDC</button>
      <div class="small muted">The contract checks the invoice. If it is already paid, cancelled or expired, your USDC comes straight back.</div>`;
    $("#near-mint")?.addEventListener("click", async () => {
      try {
        assertOk(await send(n, n.usdc, [fnCall("mint", { amount: "20000000" }, 0n, 30)]));
        toast("20 test USDC added");
        draw();
      } catch (e) {
        toast(e.message ?? "Could not mint", "bad");
      }
    });
    $("#near-pay").addEventListener("click", async e => {
      e.currentTarget.disabled = true;
      e.currentTarget.innerHTML = `<span class="spinner"></span> Approve in your wallet`;
      try {
        const out = assertOk(await send(n, n.usdc, [fnCall("ft_transfer_call", { receiver_id: n.contract, amount: inv.amount, msg: id }, 1n, 100)]));
        const logs = (out.receipts_outcome ?? []).flatMap(r => r.outcome.logs).join(" ");
        if (/payment_rejected/.test(logs)) toast("The contract refused the payment and returned your USDC", "bad");
        inv = await getInvoice(n, id, true);
        renderInvoice();
        route();
        const hash = out.transaction?.hash ?? out.transaction_outcome?.id;
        if (hash && inv.status === "Paid") $("#pay-links").innerHTML = `Payment: ${txLink(n, hash)}`;
      } catch (err) {
        toast(err.message ?? "Payment not sent", "bad");
        draw();
      }
    });
  };
  draw();
}

load();
// The shop may cancel or another payer may pay while this page is open.
setInterval(async () => {
  if (!inv || inv.status !== "Open") return;
  const fresh = await getInvoice(n, id, true).catch(() => null);
  if (fresh && fresh.status !== inv.status) {
    inv = fresh;
    clearInterval(poll);
    $("#progress").classList.add("hide");
    renderInvoice();
    route();
  }
}, 8000);
