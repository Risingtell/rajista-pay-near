//! Rajista Pay invoice registry.
//!
//! A shop creates an invoice for an exact USDC amount. The customer's payment arrives as a NEP-141
//! `ft_transfer_call` from the USDC contract with the invoice id as `msg`. NEAR Intents 1Click does
//! this when a quote sets `customRecipientMsg`, so a customer can pay from Solana, Base, Ethereum
//! or Tron and the contract, not a server, decides whether the payment settles the invoice.
//!
//! Direct payments (a NEAR wallet calling `ft_transfer_call`) follow the NEP-141 refund rules:
//! * an invoice is paid once; a second payment is refunded in full;
//! * short payments are refunded in full; anything above the amount is refunded;
//! * unknown, void or expired invoices are refunded.
//!
//! Payments that arrive through the router (`intents.near` on mainnet) are never sent back, because
//! a returned amount would go to the router rather than the customer. Instead:
//! * an open invoice that is paid in full is settled, even if it is late (the quote was issued
//!   while it was open); anything above the amount is held as `extra`;
//! * any other payment for a known invoice is held as `extra` on that invoice and credited to the
//!   shop, which owes the customer a refund and can see exactly how much;
//! * a payment for an invoice id that never existed is held as `unclaimed`, and only the owner can
//!   return it, once the customer proves the payment.
//!
//! A paid invoice can never be voided or changed. Settled money is credited to the shop's balance,
//! which only the shop can withdraw.
//!
//! Storage: the shop either attaches NEAR to `create_invoice`, or prepays with `storage_deposit` so
//! a till can create invoices with a function-call key (which cannot attach NEAR) and no wallet
//! prompt per sale.

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
const GAS_CALLBACK: Gas = Gas::from_tgas(10);

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
    StorageCredit,
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
    /// Paid after its due time (only possible through the router).
    pub late: bool,
    /// Router money received for this invoice beyond what settled it. The shop owes it back.
    pub extra: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    usdc: AccountId,
    router: Option<AccountId>,
    invoices: LookupMap<String, Invoice>,
    shop_invoices: LookupMap<AccountId, Vec<String>>,
    balances: LookupMap<AccountId, u128>,
    storage_credit: LookupMap<AccountId, u128>,
    unclaimed: u128,
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

fn zero() -> NearToken {
    NearToken::from_yoctonear(0)
}

#[near]
impl Contract {
    /// `usdc`: the only token that can pay. `router`: the account that delivers cross-chain
    /// payments (`intents.near` on mainnet); its payments are never refunded, see the module docs.
    #[init]
    pub fn new(usdc: AccountId, router: Option<AccountId>) -> Self {
        Self {
            owner: env::predecessor_account_id(),
            usdc,
            router,
            invoices: LookupMap::new(StorageKey::Invoices),
            shop_invoices: LookupMap::new(StorageKey::ShopInvoices),
            balances: LookupMap::new(StorageKey::Balances),
            storage_credit: LookupMap::new(StorageKey::StorageCredit),
            unclaimed: 0,
        }
    }

    /// The shop (the caller) issues an invoice. Storage is paid from the attached NEAR (the rest is
    /// returned) or, when nothing is attached, from the shop's prepaid storage credit.
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
            late: false,
            extra: U128(0),
        };
        self.invoices.insert(id.clone(), invoice);
        self.shop_invoices.entry(shop.clone()).or_default().push(id.clone());
        self.invoices.flush();
        self.shop_invoices.flush();
        let used = env::storage_usage().saturating_sub(before) as u128;
        let cost = env::storage_byte_cost().saturating_mul(used);
        let attached = env::attached_deposit();
        if attached > zero() {
            require!(attached >= cost, format!("attach at least {} yoctoNEAR for storage", cost.as_yoctonear()));
            let refund = attached.saturating_sub(cost);
            if refund > zero() {
                Promise::new(shop.clone()).transfer(refund).detach();
            }
        } else {
            let credit = self.storage_credit.get(&shop).copied().unwrap_or(0);
            require!(credit >= cost.as_yoctonear(), "storage credit too low: call storage_deposit or attach NEAR");
            self.storage_credit.insert(shop.clone(), credit - cost.as_yoctonear());
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

    /// Prepay storage so a till can issue invoices without attaching NEAR. Credits the caller,
    /// or `shop` if given.
    #[payable]
    pub fn storage_deposit(&mut self, shop: Option<AccountId>) -> U128 {
        let shop = shop.unwrap_or_else(env::predecessor_account_id);
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "attach NEAR to deposit");
        let credit = self.storage_credit.get(&shop).copied().unwrap_or(0) + amount;
        self.storage_credit.insert(shop, credit);
        U128(credit)
    }

    /// Return unused storage credit to the shop. Needs 1 yoctoNEAR (wallet confirmation).
    #[payable]
    pub fn storage_withdraw(&mut self, amount: Option<U128>) -> U128 {
        near_sdk::assert_one_yocto();
        let shop = env::predecessor_account_id();
        let credit = self.storage_credit.get(&shop).copied().unwrap_or(0);
        let take = amount.map(|a| a.0).unwrap_or(credit);
        require!(take > 0 && take <= credit, "nothing to withdraw, or more than the credit");
        self.storage_credit.insert(shop.clone(), credit - take);
        Promise::new(shop).transfer(NearToken::from_yoctonear(take)).detach();
        U128(credit - take)
    }

    /// The shop withdraws its USDC. Needs 1 yoctoNEAR (wallet confirmation).
    #[payable]
    pub fn withdraw(&mut self, amount: Option<U128>) -> Promise {
        near_sdk::assert_one_yocto();
        let shop = env::predecessor_account_id();
        let balance = self.balances.get(&shop).copied().unwrap_or(0);
        let take = amount.map(|a| a.0).unwrap_or(balance);
        require!(take > 0 && take <= balance, "nothing to withdraw, or more than the balance");
        self.balances.insert(shop.clone(), balance - take);
        self.send_usdc(shop.clone(), take, "Rajista Pay withdrawal")
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).after_withdraw(shop, U128(take)))
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

    /// Owner only: return router money that named an invoice id which never existed.
    #[payable]
    pub fn return_unclaimed(&mut self, receiver_id: AccountId, amount: U128, reason: String) -> Promise {
        near_sdk::assert_one_yocto();
        require!(env::predecessor_account_id() == self.owner, "only the owner can return unclaimed money");
        require!(amount.0 > 0 && amount.0 <= self.unclaimed, "more than the unclaimed total");
        self.unclaimed -= amount.0;
        self.send_usdc(receiver_id.clone(), amount.0, "Rajista Pay refund")
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).after_return(receiver_id, amount, reason))
    }

    #[private]
    pub fn after_return(&mut self, receiver_id: AccountId, amount: U128, reason: String) -> bool {
        let ok = matches!(env::promise_result(0), PromiseResult::Successful(_));
        if ok {
            emit("unclaimed_returned", json!({"to": receiver_id, "amount": amount, "reason": reason}));
        } else {
            self.unclaimed += amount.0;
        }
        ok
    }

    fn send_usdc(&self, to: AccountId, amount: u128, memo: &str) -> Promise {
        ext_ft::ext(self.usdc.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(to, U128(amount), Some(memo.into()))
    }

    fn credit(&mut self, shop: &AccountId, amount: u128) {
        let balance = self.balances.get(shop).copied().unwrap_or(0);
        self.balances.insert(shop.clone(), balance + amount);
    }

    // -- views ------------------------------------------------------------------------------

    pub fn get_invoice(&self, id: String) -> Option<Invoice> {
        self.invoices.get(&id).cloned()
    }

    /// Oldest first. Use `get_shop_invoice_count` to page from the newest end.
    pub fn get_shop_invoices(&self, shop: AccountId, from_index: Option<u32>, limit: Option<u32>) -> Vec<Invoice> {
        let ids = match self.shop_invoices.get(&shop) {
            Some(ids) => ids,
            None => return vec![],
        };
        let from = from_index.unwrap_or(0) as usize;
        let limit = limit.unwrap_or(50).min(100) as usize;
        ids.iter().skip(from).take(limit).filter_map(|id| self.invoices.get(id).cloned()).collect()
    }

    pub fn get_shop_invoice_count(&self, shop: AccountId) -> u32 {
        self.shop_invoices.get(&shop).map(|ids| ids.len() as u32).unwrap_or(0)
    }

    pub fn get_balance(&self, shop: AccountId) -> U128 {
        U128(self.balances.get(&shop).copied().unwrap_or(0))
    }

    pub fn get_storage_credit(&self, shop: AccountId) -> U128 {
        U128(self.storage_credit.get(&shop).copied().unwrap_or(0))
    }

    pub fn get_config(&self) -> near_sdk::serde_json::Value {
        json!({"owner": self.owner, "usdc": self.usdc, "router": self.router, "unclaimed": U128(self.unclaimed)})
    }
}

#[near]
impl FungibleTokenReceiver for Contract {
    /// Settles an invoice. Returns the amount to refund to the sender (NEP-141). Router payments
    /// always return zero: they settle the invoice or are held, never sent back.
    fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.usdc, "only the configured USDC contract can pay");
        let via_router = self.router.as_ref() == Some(&sender_id);
        let id = msg.trim().to_string();
        let now = now_ms();

        let Some(invoice) = self.invoices.get_mut(&id) else {
            if via_router {
                self.unclaimed += amount.0;
                emit("payment_unclaimed", json!({"id": id, "amount": amount}));
                return PromiseOrValue::Value(U128(0));
            }
            emit("payment_rejected", json!({"id": id, "payer": sender_id, "amount": amount, "reason": "unknown invoice"}));
            return PromiseOrValue::Value(amount);
        };

        let expired = invoice.due_ms.0 != 0 && now > invoice.due_ms.0;
        let problem = match invoice.status {
            Status::Paid => Some("already paid"),
            Status::Void => Some("invoice voided"),
            Status::Open if amount.0 < invoice.amount.0 => Some("short payment"),
            Status::Open if expired && !via_router => Some("invoice expired"),
            Status::Open => None,
        };
        let shop = invoice.shop.clone();

        if let Some(reason) = problem {
            if !via_router {
                emit("payment_rejected", json!({"id": id, "payer": sender_id, "amount": amount, "reason": reason}));
                return PromiseOrValue::Value(amount);
            }
            invoice.extra = U128(invoice.extra.0 + amount.0);
            self.credit(&shop, amount.0);
            emit("payment_held", json!({"id": id, "shop": shop, "amount": amount, "reason": reason}));
            return PromiseOrValue::Value(U128(0));
        }

        let due = invoice.amount.0;
        let over = amount.0 - due;
        invoice.status = Status::Paid;
        invoice.paid_ms = Some(U64(now));
        invoice.payer = Some(sender_id.clone());
        invoice.late = expired;
        let (credited, refund) = if via_router {
            invoice.extra = U128(invoice.extra.0 + over);
            (amount.0, 0)
        } else {
            (due, over)
        };
        self.credit(&shop, credited);
        emit(
            "invoice_paid",
            json!({"id": id, "shop": shop, "payer": sender_id, "amount": U128(due), "refunded": U128(refund), "extra": U128(if via_router { over } else { 0 }), "late": expired}),
        );
        PromiseOrValue::Value(U128(refund))
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
    fn router() -> AccountId {
        "intents.test".parse().unwrap()
    }
    fn owner() -> AccountId {
        accounts(0)
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
        ctx(owner(), 0, 1_000);
        Contract::new(usdc(), Some(router()))
    }

    fn create(c: &mut Contract, id: &str, amount: u128, due_ms: u64) {
        ctx(shop(), 10u128.pow(22), 1_000);
        c.create_invoice(id.into(), U128(amount), U64(due_ms), hash(), "N45,000 at N1,500/$".into());
    }

    fn pay_as(c: &mut Contract, from_token: AccountId, sender: AccountId, id: &str, amount: u128, now: u64) -> u128 {
        ctx(from_token, 0, now);
        match c.ft_on_transfer(sender, U128(amount), id.into()) {
            PromiseOrValue::Value(v) => v.0,
            PromiseOrValue::Promise(_) => panic!("unexpected promise"),
        }
    }

    fn pay(c: &mut Contract, from_token: AccountId, id: &str, amount: u128, now: u64) -> u128 {
        pay_as(c, from_token, customer(), id, amount, now)
    }

    fn routed(c: &mut Contract, id: &str, amount: u128, now: u64) -> u128 {
        pay_as(c, usdc(), router(), id, amount, now)
    }

    fn inv(c: &Contract, id: &str) -> Invoice {
        c.get_invoice(id.into()).unwrap()
    }

    // -- direct payments ---------------------------------------------------------------------

    #[test]
    fn exact_payment_settles_and_credits_the_shop() {
        let mut c = setup();
        create(&mut c, "INV-1", 30_000_000, 0);
        assert_eq!(pay(&mut c, usdc(), "INV-1", 30_000_000, 2_000), 0);
        let i = inv(&c, "INV-1");
        assert_eq!(i.status, Status::Paid);
        assert_eq!(i.payer, Some(customer()));
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
        assert_eq!(inv(&c, "INV-1").status, Status::Open);
        assert_eq!(c.get_balance(shop()).0, 0);
    }

    #[test]
    fn overpayment_refunds_the_excess() {
        let mut c = setup();
        create(&mut c, "INV-1", 30_000_000, 0);
        assert_eq!(pay(&mut c, usdc(), "INV-1", 31_500_000, 2_000), 1_500_000);
        assert_eq!(c.get_balance(shop()).0, 30_000_000);
        assert_eq!(inv(&c, "INV-1").extra.0, 0);
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
        assert_eq!(inv(&c, "INV-E").status, Status::Open);
    }

    #[test]
    #[should_panic(expected = "only the configured USDC contract can pay")]
    fn other_tokens_cannot_pay() {
        let mut c = setup();
        create(&mut c, "INV-1", 30_000_000, 0);
        pay(&mut c, "fake-usdc.test".parse().unwrap(), "INV-1", 30_000_000, 2_000);
    }

    // -- router payments: never sent back -----------------------------------------------------

    #[test]
    fn routed_exact_payment_settles() {
        let mut c = setup();
        create(&mut c, "INV-1", 30_000_000, 10_000);
        assert_eq!(routed(&mut c, "INV-1", 30_000_000, 2_000), 0);
        let i = inv(&c, "INV-1");
        assert_eq!(i.status, Status::Paid);
        assert_eq!(i.payer, Some(router()));
        assert!(!i.late);
        assert_eq!(c.get_balance(shop()).0, 30_000_000);
    }

    #[test]
    fn routed_late_payment_still_settles_and_is_marked_late() {
        let mut c = setup();
        create(&mut c, "INV-1", 10, 5_000);
        assert_eq!(routed(&mut c, "INV-1", 10, 9_000), 0);
        let i = inv(&c, "INV-1");
        assert_eq!(i.status, Status::Paid);
        assert!(i.late);
    }

    #[test]
    fn routed_overpayment_is_held_as_extra_not_returned() {
        let mut c = setup();
        create(&mut c, "INV-1", 30_000_000, 0);
        assert_eq!(routed(&mut c, "INV-1", 30_400_000, 2_000), 0);
        assert_eq!(inv(&c, "INV-1").extra.0, 400_000);
        assert_eq!(c.get_balance(shop()).0, 30_400_000);
    }

    #[test]
    fn routed_double_short_and_void_payments_are_held_for_the_shop_to_refund() {
        let mut c = setup();
        create(&mut c, "INV-1", 10, 0);
        routed(&mut c, "INV-1", 10, 2_000);
        assert_eq!(routed(&mut c, "INV-1", 10, 3_000), 0); // double
        create(&mut c, "INV-2", 10, 0);
        assert_eq!(routed(&mut c, "INV-2", 4, 3_000), 0); // short
        assert_eq!(inv(&c, "INV-2").status, Status::Open);
        create(&mut c, "INV-3", 10, 0);
        ctx(shop(), 0, 3_000);
        c.void_invoice("INV-3".into());
        assert_eq!(routed(&mut c, "INV-3", 10, 4_000), 0); // void
        assert_eq!(inv(&c, "INV-1").extra.0, 10);
        assert_eq!(inv(&c, "INV-2").extra.0, 4);
        assert_eq!(inv(&c, "INV-3").extra.0, 10);
        assert_eq!(c.get_balance(shop()).0, 10 + 10 + 4 + 10);
        assert!(get_logs().iter().any(|l| l.contains("payment_held")));
    }

    #[test]
    fn routed_payment_to_an_unknown_id_is_unclaimed_and_only_the_owner_can_return_it() {
        let mut c = setup();
        assert_eq!(routed(&mut c, "NOPE", 7, 2_000), 0);
        assert_eq!(c.get_config()["unclaimed"], "7");
        ctx(owner(), 1, 3_000);
        let _ = c.return_unclaimed(customer(), U128(7), "proved by origin tx".into());
        assert_eq!(c.get_config()["unclaimed"], "0");
    }

    #[test]
    #[should_panic(expected = "only the owner can return unclaimed money")]
    fn others_cannot_return_unclaimed() {
        let mut c = setup();
        routed(&mut c, "NOPE", 7, 2_000);
        ctx(shop(), 1, 3_000);
        let _ = c.return_unclaimed(shop(), U128(7), "".into());
    }

    #[test]
    #[should_panic(expected = "more than the unclaimed total")]
    fn owner_cannot_take_settled_money() {
        let mut c = setup();
        create(&mut c, "INV-1", 10, 0);
        routed(&mut c, "INV-1", 10, 2_000);
        ctx(owner(), 1, 3_000);
        let _ = c.return_unclaimed(owner(), U128(10), "".into());
    }

    #[test]
    fn without_a_router_every_payment_follows_refund_rules() {
        ctx(owner(), 0, 1_000);
        let mut c = Contract::new(usdc(), None);
        create(&mut c, "INV-1", 10, 0);
        pay_as(&mut c, usdc(), router(), "INV-1", 10, 2_000);
        assert_eq!(pay_as(&mut c, usdc(), router(), "INV-1", 10, 3_000), 10);
    }

    // -- shop controls ------------------------------------------------------------------------

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
    #[should_panic(expected = "storage credit too low")]
    fn storage_must_be_paid_by_the_shop() {
        let mut c = setup();
        ctx(shop(), 0, 1_000);
        c.create_invoice("INV-1".into(), U128(10), U64(0), hash(), "".into());
    }

    #[test]
    #[should_panic(expected = "attach at least")]
    fn attaching_too_little_fails() {
        let mut c = setup();
        ctx(shop(), 1, 1_000);
        c.create_invoice("INV-1".into(), U128(10), U64(0), hash(), "".into());
    }

    #[test]
    fn prepaid_storage_lets_a_till_key_issue_invoices() {
        let mut c = setup();
        ctx(shop(), 10u128.pow(23), 1_000);
        c.storage_deposit(None);
        ctx(shop(), 0, 1_000);
        c.create_invoice("INV-1".into(), U128(10), U64(0), hash(), "".into());
        let left = c.get_storage_credit(shop()).0;
        assert!(left < 10u128.pow(23) && left > 0);
        ctx(shop(), 1, 1_000);
        assert_eq!(c.storage_withdraw(None).0, 0);
        assert_eq!(c.get_storage_credit(shop()).0, 0);
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
        assert_eq!(c.get_shop_invoice_count(shop()), 5);
    }
}
