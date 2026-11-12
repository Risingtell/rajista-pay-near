//! The contract's entry points: what near-sdk's `#[near]` macro would generate, written by hand.
//! Each one reads JSON arguments, makes the same checks the macro makes (no deposit unless the
//! method is payable, private callbacks only from the contract itself, init exactly once), runs
//! the method, saves state and writes the JSON result.

use crate::json::{self, Args};
use crate::Contract;
use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::{env, require};

fn load() -> Contract {
    env::state_read().unwrap_or_else(|| env::panic_str("contract is not initialized"))
}

fn save(c: &Contract) {
    env::state_write(c);
}

fn no_deposit() {
    require!(env::attached_deposit().is_zero(), "this method does not accept a deposit");
}

fn private() {
    require!(env::predecessor_account_id() == env::current_account_id(), "this method is private");
}

fn ret(s: String) {
    env::value_return(s.as_bytes());
}

fn ret_q(v: u128) {
    let mut s = String::new();
    json::qnum(&mut s, v);
    ret(s);
}

fn ret_bool(v: bool) {
    ret(String::from(if v { "true" } else { "false" }));
}

// -- calls ----------------------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn new() {
    no_deposit();
    require!(!env::state_exists(), "already initialized");
    let a = Args::from_input();
    let c = Contract::new(a.account("usdc"), a.opt_account("router"));
    save(&c);
}

#[no_mangle]
pub extern "C" fn create_invoice() {
    let a = Args::from_input();
    let mut c = load();
    c.create_invoice(a.str("id"), U128(a.u128("amount")), U64(a.u64("due_in_ms")), Base64VecU8(a.base64("items_hash")), a.str("note"));
    save(&c);
}

#[no_mangle]
pub extern "C" fn void_invoice() {
    no_deposit();
    let a = Args::from_input();
    let mut c = load();
    c.void_invoice(a.str("id"));
    save(&c);
}

#[no_mangle]
pub extern "C" fn storage_deposit() {
    let a = Args::from_input();
    let mut c = load();
    let credit = c.storage_deposit(a.opt_account("shop"));
    save(&c);
    ret_q(credit.0);
}

#[no_mangle]
pub extern "C" fn storage_withdraw() {
    let a = Args::from_input();
    let mut c = load();
    let left = c.storage_withdraw(a.opt_u128("amount").map(U128));
    save(&c);
    ret_q(left.0);
}

#[no_mangle]
pub extern "C" fn withdraw() {
    let a = Args::from_input();
    let mut c = load();
    let p = c.withdraw(a.opt_u128("amount").map(U128));
    save(&c);
    p.as_return().detach();
}

#[no_mangle]
pub extern "C" fn after_withdraw() {
    no_deposit();
    private();
    let a = Args::from_input();
    let mut c = load();
    let ok = c.after_withdraw(a.account("shop"), U128(a.u128("amount")));
    save(&c);
    ret_bool(ok);
}

#[no_mangle]
pub extern "C" fn return_unclaimed() {
    let a = Args::from_input();
    let mut c = load();
    let p = c.return_unclaimed(a.account("receiver_id"), U128(a.u128("amount")), a.str("reason"));
    save(&c);
    p.as_return().detach();
}

#[no_mangle]
pub extern "C" fn after_return() {
    no_deposit();
    private();
    let a = Args::from_input();
    let mut c = load();
    let ok = c.after_return(a.account("receiver_id"), U128(a.u128("amount")), a.str("reason"));
    save(&c);
    ret_bool(ok);
}

#[no_mangle]
pub extern "C" fn ft_on_transfer() {
    no_deposit();
    let a = Args::from_input();
    let mut c = load();
    let refund = c.ft_on_transfer(a.account("sender_id"), U128(a.u128("amount")), a.str("msg"));
    save(&c);
    ret_q(refund.0);
}

// -- views (never write state) ----------------------------------------------------------------

#[no_mangle]
pub extern "C" fn get_invoice() {
    let a = Args::from_input();
    ret(match load().get_invoice(a.str("id")) {
        Some(inv) => inv.to_json(),
        None => String::from("null"),
    });
}

#[no_mangle]
pub extern "C" fn get_shop_invoices() {
    let a = Args::from_input();
    let list = load().get_shop_invoices(a.account("shop"), a.opt_u32("from_index"), a.opt_u32("limit"));
    let mut s = String::from("[");
    for (i, inv) in list.iter().enumerate() {
        if i > 0 {
            s.push(',');
        }
        s.push_str(&inv.to_json());
    }
    s.push(']');
    ret(s);
}

#[no_mangle]
pub extern "C" fn get_shop_invoice_count() {
    let a = Args::from_input();
    let mut s = String::new();
    json::num(&mut s, load().get_shop_invoice_count(a.account("shop")) as u128);
    ret(s);
}

#[no_mangle]
pub extern "C" fn get_balance() {
    let a = Args::from_input();
    ret_q(load().get_balance(a.account("shop")).0);
}

#[no_mangle]
pub extern "C" fn get_storage_credit() {
    let a = Args::from_input();
    ret_q(load().get_storage_credit(a.account("shop")).0);
}

#[no_mangle]
pub extern "C" fn get_config() {
    ret(load().get_config().to_json());
}
