//! Rajista Pay invoice registry.
//!
//! A shop creates an invoice for an exact USDC amount. The customer's payment arrives as a NEP-141
//! `ft_transfer_call` from the USDC contract with the invoice id as `msg` (NEAR Intents 1Click does
//! this when a quote sets `customRecipientMsg`). The contract, not a server, decides whether the
//! payment settles the invoice:
//!
//! * only the configured USDC contract can pay;
//! * an invoice is paid once; a second payment is refunded in full;
//! * short payments are refunded in full; anything above the amount is refunded;
//! * unknown, void or expired invoices are refunded;
//! * a paid invoice can never be voided or changed.
//!
//! Settled money is credited to the shop's balance, which only the shop can withdraw.

use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::serde_json::json;
use near_sdk::store::LookupMap;
use near_sdk::{
    env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
    PromiseOrValue, PromiseResult,
};

const EVENT_STANDARD: &str = "rajista_pay";
const EVENT_VERSION: &str = "1.0.0";
const MAX_ID_LEN: usize = 64;
const MAX_NOTE_LEN: usize = 200;
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_AFTER_WITHDRAW: Gas = Gas::from_tgas(10);

#[ext_contract(ext_ft)]
pub trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Invoices,
    ShopInvoices,
    Balances,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum Status {
    Open,
    Paid,
    Void,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Invoice {
    pub id: String,
    pub shop: AccountId,
    /// USDC in its smallest unit (6 decimals).
    pub amount: U128,
    /// Unix milliseconds; 0 = no expiry.
    pub due_ms: U64,
    /// SHA-256 of the line items JSON, so the items cannot change after issue.
    pub items_hash: Base64VecU8,
    /// Free text such as "N45,000 at N1,500/$", kept for the receipt.
    pub note: String,
    pub status: Status,
    pub created_ms: U64,
    pub paid_ms: Option<U64>,
    pub payer: Option<AccountId>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    usdc: AccountId,
    invoices: LookupMap<String, Invoice>,
    shop_invoices: LookupMap<AccountId, Vec<String>>,
    balances: LookupMap<AccountId, u128>,
}

fn emit(event: &str, data: near_sdk::serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({"standard": EVENT_STANDARD, "version": EVENT_VERSION, "event": event, "data": [data]})
    ));
}

fn now_ms() -> u64 {
    env::block_timestamp_ms()
}

#[near]
impl Contract {
    #[init]
    pub fn new(usdc: AccountId) -> Self {
        Self {
            usdc,
            invoices: LookupMap::new(StorageKey::Invoices),
            shop_invoices: LookupMap::new(StorageKey::ShopInvoices),
            balances: LookupMap::new(StorageKey::Balances),
        }
    }

    /// The shop (the caller) issues an invoice. The caller attaches NEAR to cover the storage the
    /// invoice uses; anything left over is returned. Ids are unique forever.
    #[payable]
    pub fn create_invoice(&mut self, id: String, amount: U128, due_ms: U64, items_hash: Base64VecU8, note: String) {
        let shop = env::predecessor_account_id();
        require!(!id.is_empty() && id.len() <= MAX_ID_LEN, "id must be 1-64 characters");
        require!(id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'), "id may use letters, digits, - and _");
        require!(amount.0 > 0, "amount must be above zero");
        require!(items_hash.0.len() == 32, "items_hash must be a SHA-256 digest");
        require!(note.len() <= MAX_NOTE_LEN, "note is too long");
        require!(due_ms.0 == 0 || due_ms.0 > now_ms(), "due date is in the past");
        require!(!self.invoices.contains_key(&id), "invoice id already used");

        let before = env::storage_usage();
        let invoice = Invoice {
            id: id.clone(),
            shop: shop.clone(),
            amount,
            due_ms,
            items_hash,
            note,
            status: Status::Open,
            created_ms: U64(now_ms()),
            paid_ms: None,
            payer: None,
        };
        self.invoices.insert(id.clone(), invoice);
        self.shop_invoices.entry(shop.clone()).or_default().push(id.clone());
        self.invoices.flush();
        self.shop_invoices.flush();
        let used = env::storage_usage().saturating_sub(before) as u128;
        let cost = env::storage_byte_cost().saturating_mul(used);
        let attached = env::attached_deposit();
        require!(attached >= cost, format!("attach at least {} yoctoNEAR for storage", cost.as_yoctonear()));
        let refund = attached.saturating_sub(cost);
        if refund > NearToken::from_yoctonear(0) {
            Promise::new(shop.clone()).transfer(refund).detach();
        }
        emit("invoice_created", json!({"id": id, "shop": shop, "amount": amount}));
    }

    /// Only the shop can void, and only an open invoice.
    pub fn void_invoice(&mut self, id: String) {
        let caller = env::predecessor_account_id();
        let invoice = self.invoices.get_mut(&id).unwrap_or_else(|| env::panic_str("no such invoice"));
        require!(invoice.shop == caller, "only the shop that issued the invoice can void it");
        require!(invoice.status == Status::Open, "only an open invoice can be voided");
        invoice.status = Status::Void;
        emit("invoice_voided", json!({"id": id}));
    }

    /// The shop withdraws its settled USDC. Needs 1 yoctoNEAR (wallet confirmation).
    #[payable]
    pub fn withdraw(&mut self, amount: Option<U128>) -> Promise {
        near_sdk::assert_one_yocto();
        let shop = env::predecessor_account_id();
        let balance = self.balances.get(&shop).copied().unwrap_or(0);
        let take = amount.map(|a| a.0).unwrap_or(balance);
        require!(take > 0 && take <= balance, "nothing to withdraw, or more than the balance");
        self.balances.insert(shop.clone(), balance - take);
        ext_ft::ext(self.usdc.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(shop.clone(), U128(take), Some("Rajista Pay withdrawal".into()))
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_AFTER_WITHDRAW).after_withdraw(shop, U128(take)))
    }

    /// If the token transfer failed, the money goes back on the shop's balance.
    #[private]
    pub fn after_withdraw(&mut self, shop: AccountId, amount: U128) -> bool {
        let ok = matches!(env::promise_result(0), PromiseResult::Successful(_));
        if ok {
            emit("withdrawn", json!({"shop": shop, "amount": amount}));
        } else {
            let balance = self.balances.get(&shop).copied().unwrap_or(0);
            self.balances.insert(shop.clone(), balance + amount.0);
            emit("withdraw_failed", json!({"shop": shop, "amount": amount}));
        }
        ok
    }

    // -- views ------------------------------------------------------------------------------

    pub fn get_invoice(&self, id: String) -> Option<Invoice> {
        self.invoices.get(&id).cloned()
    }

    pub fn get_shop_invoices(&self, shop: AccountId, from_index: Option<u32>, limit: Option<u32>) -> Vec<Invoice> {
        let ids = match self.shop_invoices.get(&shop) {
            Some(ids) => ids,
            None => return vec![],
        };
        let from = from_index.unwrap_or(0) as usize;
        let limit = limit.unwrap_or(50).min(100) as usize;
        ids.iter().skip(from).take(limit).filter_map(|id| self.invoices.get(id).cloned()).collect()
    }

    pub fn get_balance(&self, shop: AccountId) -> U128 {
        U128(self.balances.get(&shop).copied().unwrap_or(0))
    }

    pub fn get_usdc(&self) -> AccountId {
        self.usdc.clone()
    }
}

#[near]
impl FungibleTokenReceiver for Contract {
    /// Settles an invoice. Returns the amount to refund to the sender (NEP-141): everything when the
    /// payment is rejected, the excess when it is overpaid, zero when it is exact.
    fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.usdc, "only the configured USDC contract can pay");
        let id = msg.trim().to_string();
        let reject = |reason: &str| {
            emit("payment_rejected", json!({"id": id, "payer": sender_id, "amount": amount, "reason": reason}));
            PromiseOrValue::Value(amount)
        };
        let Some(invoice) = self.invoices.get_mut(&id) else { return reject("unknown invoice") };
        match invoice.status {
            Status::Paid => return reject("already paid"),
            Status::Void => return reject("invoice voided"),
            Status::Open => {}
        }
        if invoice.due_ms.0 != 0 && now_ms() > invoice.due_ms.0 {
            return reject("invoice expired");
        }
        if amount.0 < invoice.amount.0 {
            return reject("short payment");
        }
        let due = invoice.amount.0;
        invoice.status = Status::Paid;
        invoice.paid_ms = Some(U64(now_ms()));
        invoice.payer = Some(sender_id.clone());
        let shop = invoice.shop.clone();
        let balance = self.balances.get(&shop).copied().unwrap_or(0);
        self.balances.insert(shop.clone(), balance + due);
        emit("invoice_paid", json!({"id": id, "shop": shop, "payer": sender_id, "amount": U128(due), "refunded": U128(amount.0 - due)}));
        PromiseOrValue::Value(U128(amount.0 - due))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, get_logs, VMContextBuilder};
    use near_sdk::testing_env;

    fn usdc() -> AccountId {
        "usdc.test".parse().unwrap()
    }
    fn shop() -> AccountId {
        accounts(1)
    }
    fn customer() -> AccountId {
        accounts(2)
    }
    fn hash() -> Base64VecU8 {
        Base64VecU8(vec![7u8; 32])
    }

    fn ctx(predecessor: AccountId, deposit: u128, now_ms: u64) {
        let mut b = VMContextBuilder::new();
        b.current_account_id("pay.test".parse().unwrap())
            .predecessor_account_id(predecessor)
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .block_timestamp(now_ms * 1_000_000);
        testing_env!(b.build());
    }

    fn setup() -> Contract {
        ctx(shop(), 0, 1_000);
        Contract::new(usdc())
    }

    fn create(c: &mut Contract, id: &str, amount: u128, due_ms: u64) {
        ctx(shop(), 10u128.pow(22), 1_000);
        c.create_invoice(id.into(), U128(amount), U64(due_ms), hash(), "N45,000 at N1,500/$".into());
    }

    fn pay(c: &mut Contract, from_token: AccountId, id: &str, amount: u128, now: u64) -> u128 {
        ctx(from_token, 0, now);
        match c.ft_on_transfer(customer(), U128(amount), id.into()) {
            PromiseOrValue::Value(v) => v.0,
            PromiseOrValue::Promise(_) => panic!("unexpected promise"),
        }
    }

    #[test]
    fn exact_payment_settles_and_credits_the_shop() {
        let mut c = setup();
        create(&mut c, "INV-1", 30_000_000, 0);
        assert_eq!(pay(&mut c, usdc(), "INV-1", 30_000_000, 2_000), 0);
        let inv = c.get_invoice("INV-1".into()).unwrap();
        assert_eq!(inv.status, Status::Paid);
        assert_eq!(inv.payer, Some(customer()));
        assert_eq!(c.get_balance(shop()).0, 30_000_000);
        assert!(get_logs().iter().any(|l| l.contains("invoice_paid")));
    }

    #[test]
    fn second_payment_is_refunded_in_full() {
        let mut c = setup();
        create(&mut c, "INV-1", 30_000_000, 0);
        pay(&mut c, usdc(), "INV-1", 30_000_000, 2_000);
        assert_eq!(pay(&mut c, usdc(), "INV-1", 30_000_000, 3_000), 30_000_000);
        assert_eq!(c.get_balance(shop()).0, 30_000_000);
        assert!(get_logs().iter().any(|l| l.contains("already paid")));
    }

    #[test]
    fn short_payment_is_refunded_and_invoice_stays_open() {
        let mut c = setup();
        create(&mut c, "INV-1", 30_000_000, 0);
        assert_eq!(pay(&mut c, usdc(), "INV-1", 29_999_999, 2_000), 29_999_999);
        assert_eq!(c.get_invoice("INV-1".into()).unwrap().status, Status::Open);
        assert_eq!(c.get_balance(shop()).0, 0);
    }

    #[test]
    fn overpayment_refunds_the_excess() {
        let mut c = setup();
        create(&mut c, "INV-1", 30_000_000, 0);
        assert_eq!(pay(&mut c, usdc(), "INV-1", 31_500_000, 2_000), 1_500_000);
        assert_eq!(c.get_balance(shop()).0, 30_000_000);
    }

    #[test]
    fn unknown_void_and_expired_invoices_are_refunded() {
        let mut c = setup();
        assert_eq!(pay(&mut c, usdc(), "NOPE", 5, 2_000), 5);
        create(&mut c, "INV-V", 10, 0);
        ctx(shop(), 0, 2_000);
        c.void_invoice("INV-V".into());
        assert_eq!(pay(&mut c, usdc(), "INV-V", 10, 3_000), 10);
        create(&mut c, "INV-E", 10, 5_000);
        assert_eq!(pay(&mut c, usdc(), "INV-E", 10, 6_000), 10);
        assert_eq!(c.get_balance(shop()).0, 0);
    }

    #[test]
    #[should_panic(expected = "only the configured USDC contract can pay")]
    fn other_tokens_cannot_pay() {
        let mut c = setup();
        create(&mut c, "INV-1", 30_000_000, 0);
        pay(&mut c, "fake-usdc.test".parse().unwrap(), "INV-1", 30_000_000, 2_000);
    }

    #[test]
    #[should_panic(expected = "only the shop that issued the invoice can void it")]
    fn only_the_shop_can_void() {
        let mut c = setup();
        create(&mut c, "INV-1", 10, 0);
        ctx(customer(), 0, 2_000);
        c.void_invoice("INV-1".into());
    }

    #[test]
    #[should_panic(expected = "only an open invoice can be voided")]
    fn a_paid_invoice_cannot_be_voided() {
        let mut c = setup();
        create(&mut c, "INV-1", 10, 0);
        pay(&mut c, usdc(), "INV-1", 10, 2_000);
        ctx(shop(), 0, 3_000);
        c.void_invoice("INV-1".into());
    }

    #[test]
    #[should_panic(expected = "invoice id already used")]
    fn ids_are_unique_forever() {
        let mut c = setup();
        create(&mut c, "INV-1", 10, 0);
        create(&mut c, "INV-1", 20, 0);
    }

    #[test]
    #[should_panic(expected = "attach at least")]
    fn storage_must_be_paid_by_the_shop() {
        let mut c = setup();
        ctx(shop(), 0, 1_000);
        c.create_invoice("INV-1".into(), U128(10), U64(0), hash(), "".into());
    }

    #[test]
    #[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
    fn withdraw_needs_one_yocto() {
        let mut c = setup();
        ctx(shop(), 0, 1_000);
        c.withdraw(None);
    }

    #[test]
    #[should_panic(expected = "nothing to withdraw")]
    fn cannot_withdraw_more_than_the_balance() {
        let mut c = setup();
        ctx(shop(), 1, 1_000);
        c.withdraw(Some(U128(1)));
    }

    #[test]
    fn shop_listing_pages() {
        let mut c = setup();
        for i in 0..5 {
            create(&mut c, &format!("INV-{i}"), 10, 0);
        }
        let page = c.get_shop_invoices(shop(), Some(2), Some(2));
        assert_eq!(page.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(), vec!["INV-2", "INV-3"]);
    }
}
