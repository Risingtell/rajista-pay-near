//! The contract's JSON in and out, written by hand.
//!
//! near-sdk's generated JSON layer roughly doubles the contract's size, and every byte of code
//! costs NEAR to store. Arguments here are always flat objects of strings, numbers, booleans and
//! nulls, so a small strict reader and writer cover them. Anything else is rejected.

use near_sdk::{env, AccountId};

pub enum Val {
    Str(String),
    Num(u64),
    Bool(bool),
    Null,
}

pub struct Args(Vec<(String, Val)>);

fn bad() -> ! {
    env::panic_str("invalid JSON arguments")
}

struct Reader<'a> {
    b: &'a [u8],
    i: usize,
}

impl<'a> Reader<'a> {
    fn ws(&mut self) {
        while self.i < self.b.len() && matches!(self.b[self.i], b' ' | b'\t' | b'\n' | b'\r') {
            self.i += 1;
        }
    }
    fn next(&mut self) -> u8 {
        let c = *self.b.get(self.i).unwrap_or_else(|| bad());
        self.i += 1;
        c
    }
    fn eat(&mut self, c: u8) {
        self.ws();
        if self.next() != c {
            bad()
        }
    }
    fn literal(&mut self, word: &[u8]) {
        if self.b.len() < self.i + word.len() || &self.b[self.i..self.i + word.len()] != word {
            bad()
        }
        self.i += word.len();
    }
    fn hex4(&mut self) -> u32 {
        let mut v = 0u32;
        for _ in 0..4 {
            let c = self.next();
            let d = match c {
                b'0'..=b'9' => c - b'0',
                b'a'..=b'f' => c - b'a' + 10,
                b'A'..=b'F' => c - b'A' + 10,
                _ => bad(),
            };
            v = v * 16 + d as u32;
        }
        v
    }
    fn string(&mut self) -> String {
        self.eat(b'"');
        let mut out: Vec<u8> = Vec::new();
        loop {
            let c = self.next();
            match c {
                b'"' => break,
                b'\\' => {
                    let e = self.next();
                    let ch = match e {
                        b'"' => '"',
                        b'\\' => '\\',
                        b'/' => '/',
                        b'b' => '\u{8}',
                        b'f' => '\u{c}',
                        b'n' => '\n',
                        b'r' => '\r',
                        b't' => '\t',
                        b'u' => {
                            let hi = self.hex4();
                            let code = if (0xD800..0xDC00).contains(&hi) {
                                if self.next() != b'\\' || self.next() != b'u' {
                                    bad()
                                }
                                let lo = self.hex4();
                                if !(0xDC00..0xE000).contains(&lo) {
                                    bad()
                                }
                                0x10000 + ((hi - 0xD800) << 10) + (lo - 0xDC00)
                            } else {
                                hi
                            };
                            char::from_u32(code).unwrap_or_else(|| bad())
                        }
                        _ => bad(),
                    };
                    let mut buf = [0u8; 4];
                    out.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
                }
                0..=0x1f => bad(),
                _ => out.push(c),
            }
        }
        String::from_utf8(out).unwrap_or_else(|_| bad())
    }
    fn value(&mut self) -> Val {
        self.ws();
        match self.b.get(self.i) {
            Some(b'"') => Val::Str(self.string()),
            Some(b'n') => {
                self.literal(b"null");
                Val::Null
            }
            Some(b't') => {
                self.literal(b"true");
                Val::Bool(true)
            }
            Some(b'f') => {
                self.literal(b"false");
                Val::Bool(false)
            }
            Some(b'0'..=b'9') => {
                let mut v: u64 = 0;
                while let Some(c @ b'0'..=b'9') = self.b.get(self.i).copied() {
                    v = v.checked_mul(10).and_then(|v| v.checked_add((c - b'0') as u64)).unwrap_or_else(|| bad());
                    self.i += 1;
                }
                if matches!(self.b.get(self.i), Some(b'.' | b'e' | b'E')) {
                    bad()
                }
                Val::Num(v)
            }
            _ => bad(),
        }
    }
}

impl Args {
    pub fn parse(input: &[u8]) -> Args {
        let mut r = Reader { b: input, i: 0 };
        r.ws();
        let mut fields = Vec::new();
        if r.i == r.b.len() {
            return Args(fields); // no arguments
        }
        r.eat(b'{');
        r.ws();
        if r.b.get(r.i) == Some(&b'}') {
            r.i += 1;
        } else {
            loop {
                r.ws();
                let k = r.string();
                r.eat(b':');
                let v = r.value();
                if fields.iter().any(|(f, _): &(String, Val)| *f == k) {
                    bad() // duplicate keys are ambiguous
                }
                fields.push((k, v));
                r.ws();
                match r.next() {
                    b',' => continue,
                    b'}' => break,
                    _ => bad(),
                }
            }
        }
        r.ws();
        if r.i != r.b.len() {
            bad()
        }
        Args(fields)
    }

    pub fn from_input() -> Args {
        Args::parse(&env::input().unwrap_or_default())
    }

    fn get(&self, k: &str) -> Option<&Val> {
        self.0.iter().find(|(f, _)| f == k).map(|(_, v)| v).filter(|v| !matches!(v, Val::Null))
    }

    pub fn opt_str(&self, k: &str) -> Option<String> {
        match self.get(k) {
            Some(Val::Str(s)) => Some(s.clone()),
            None => None,
            _ => missing(k),
        }
    }
    pub fn str(&self, k: &str) -> String {
        self.opt_str(k).unwrap_or_else(|| missing(k))
    }
    pub fn opt_account(&self, k: &str) -> Option<AccountId> {
        self.opt_str(k).map(|s| s.parse().unwrap_or_else(|_| env::panic_str("invalid account id")))
    }
    pub fn account(&self, k: &str) -> AccountId {
        self.opt_account(k).unwrap_or_else(|| missing(k))
    }
    /// u128 and u64 travel as decimal strings, like near-sdk's U128 and U64.
    pub fn opt_u128(&self, k: &str) -> Option<u128> {
        self.opt_str(k).map(|s| parse_u128(&s))
    }
    pub fn u128(&self, k: &str) -> u128 {
        self.opt_u128(k).unwrap_or_else(|| missing(k))
    }
    pub fn u64(&self, k: &str) -> u64 {
        let v = self.u128(k);
        if v > u64::MAX as u128 {
            bad()
        }
        v as u64
    }
    pub fn opt_u32(&self, k: &str) -> Option<u32> {
        match self.get(k) {
            Some(Val::Num(n)) if *n <= u32::MAX as u64 => Some(*n as u32),
            None => None,
            _ => bad(),
        }
    }
    pub fn base64(&self, k: &str) -> Vec<u8> {
        base64_decode(&self.str(k)).unwrap_or_else(|| env::panic_str("invalid base64"))
    }
}

fn missing(k: &str) -> ! {
    let mut m = String::from("missing or invalid argument: ");
    m.push_str(k);
    env::panic_str(&m)
}

pub fn parse_u128(s: &str) -> u128 {
    if s.is_empty() || s.len() > 39 {
        bad()
    }
    let mut v: u128 = 0;
    for c in s.bytes() {
        if !c.is_ascii_digit() {
            bad()
        }
        v = v.checked_mul(10).and_then(|v| v.checked_add((c - b'0') as u128)).unwrap_or_else(|| bad());
    }
    v
}

// -- writing ------------------------------------------------------------------------------------

pub fn num(out: &mut String, mut v: u128) {
    let mut buf = [0u8; 40];
    let mut i = buf.len();
    loop {
        i -= 1;
        buf[i] = b'0' + (v % 10) as u8;
        v /= 10;
        if v == 0 {
            break;
        }
    }
    // Only ASCII digits were written.
    out.push_str(core::str::from_utf8(&buf[i..]).unwrap_or_default());
}

pub fn string(out: &mut String, s: &str) {
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                const HEX: &[u8; 16] = b"0123456789abcdef";
                out.push_str("\\u00");
                out.push(HEX[(c as usize) >> 4] as char);
                out.push(HEX[(c as usize) & 15] as char);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

/// A u128 or u64 as a quoted decimal string.
pub fn qnum(out: &mut String, v: u128) {
    out.push('"');
    num(out, v);
    out.push('"');
}

/// Builds a flat JSON object field by field.
pub struct Obj(pub String);

impl Obj {
    pub fn new() -> Obj {
        Obj(String::from("{"))
    }
    fn key(&mut self, k: &str) {
        if self.0.len() > 1 {
            self.0.push(',');
        }
        string(&mut self.0, k);
        self.0.push(':');
    }
    pub fn s(mut self, k: &str, v: &str) -> Obj {
        self.key(k);
        string(&mut self.0, v);
        self
    }
    pub fn opt_s(mut self, k: &str, v: Option<&str>) -> Obj {
        self.key(k);
        match v {
            Some(v) => string(&mut self.0, v),
            None => self.0.push_str("null"),
        }
        self
    }
    pub fn q(mut self, k: &str, v: u128) -> Obj {
        self.key(k);
        qnum(&mut self.0, v);
        self
    }
    pub fn opt_q(mut self, k: &str, v: Option<u128>) -> Obj {
        self.key(k);
        match v {
            Some(v) => qnum(&mut self.0, v),
            None => self.0.push_str("null"),
        }
        self
    }
    pub fn b(mut self, k: &str, v: bool) -> Obj {
        self.key(k);
        self.0.push_str(if v { "true" } else { "false" });
        self
    }
    pub fn end(mut self) -> String {
        self.0.push('}');
        self.0
    }
}

// -- base64 (standard alphabet, padded) ---------------------------------------------------------

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub fn base64_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(B64[(n >> 18) as usize & 63] as char);
        out.push(B64[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { B64[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { B64[n as usize & 63] as char } else { '=' });
    }
    out
}

pub fn base64_decode(s: &str) -> Option<Vec<u8>> {
    let b = s.as_bytes();
    if b.len() % 4 != 0 {
        return None;
    }
    let val = |c: u8| -> Option<u32> {
        match c {
            b'A'..=b'Z' => Some((c - b'A') as u32),
            b'a'..=b'z' => Some((c - b'a' + 26) as u32),
            b'0'..=b'9' => Some((c - b'0' + 52) as u32),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    };
    let mut out = Vec::with_capacity(b.len() / 4 * 3);
    for (k, q) in b.chunks(4).enumerate() {
        let last = k == b.len() / 4 - 1;
        let pad = q.iter().rev().take_while(|&&c| c == b'=').count();
        if pad > 2 || (pad > 0 && !last) {
            return None;
        }
        let mut n = 0u32;
        for (j, &c) in q.iter().enumerate() {
            n <<= 6;
            if j < 4 - pad {
                n |= val(c)?;
            }
        }
        out.push((n >> 16) as u8);
        if pad < 2 {
            out.push((n >> 8) as u8);
        }
        if pad < 1 {
            out.push(n as u8);
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_flat_objects() {
        let a = Args::parse(br#" { "id" : "INV-1", "amount":"12500000", "limit": 5, "router": null, "x": true } "#);
        assert_eq!(a.str("id"), "INV-1");
        assert_eq!(a.u128("amount"), 12_500_000);
        assert_eq!(a.opt_u32("limit"), Some(5));
        assert_eq!(a.opt_str("router"), None);
        assert_eq!(a.opt_str("absent"), None);
        assert_eq!(Args::parse(b"").opt_str("id"), None);
        assert_eq!(Args::parse(b"{}").opt_str("id"), None);
    }

    #[test]
    fn reads_escapes_like_serde_json_writes_them() {
        let a = Args::parse(r#"{"msg":"a\"b\\c\/d\n₦😀"}"#.as_bytes());
        assert_eq!(a.str("msg"), "a\"b\\c/d\n₦😀");
    }

    #[test]
    #[should_panic(expected = "invalid JSON arguments")]
    fn rejects_nested_values() {
        Args::parse(br#"{"a":{"b":1}}"#);
    }

    #[test]
    #[should_panic(expected = "invalid JSON arguments")]
    fn rejects_trailing_garbage() {
        Args::parse(br#"{"a":"b"} x"#);
    }

    #[test]
    #[should_panic(expected = "invalid JSON arguments")]
    fn rejects_duplicate_keys() {
        Args::parse(br#"{"msg":"A","msg":"B"}"#);
    }

    #[test]
    #[should_panic(expected = "invalid JSON arguments")]
    fn rejects_u128_overflow() {
        parse_u128("340282366920938463463374607431768211456");
    }

    #[test]
    fn u128_round_trip() {
        let mut s = String::new();
        num(&mut s, u128::MAX);
        assert_eq!(s, "340282366920938463463374607431768211455");
        assert_eq!(parse_u128(&s), u128::MAX);
        let mut z = String::new();
        num(&mut z, 0);
        assert_eq!(z, "0");
    }

    #[test]
    fn writes_escaped_strings() {
        let o = Obj::new().s("note", "₦20,000 \"cash\"\n\u{1}").q("amount", 5).b("late", false).opt_s("payer", None).end();
        assert_eq!(o, r#"{"note":"₦20,000 \"cash\"\n\u0001","amount":"5","late":false,"payer":null}"#);
    }

    #[test]
    fn base64_matches_the_standard() {
        for (raw, enc) in [(&b""[..], ""), (b"f", "Zg=="), (b"fo", "Zm8="), (b"foo", "Zm9v"), (b"foobar", "Zm9vYmFy")] {
            assert_eq!(base64_encode(raw), enc);
            assert_eq!(base64_decode(enc).unwrap(), raw);
        }
        let h = [7u8; 32];
        assert_eq!(base64_decode(&base64_encode(&h)).unwrap(), h);
        assert!(base64_decode("Zg=").is_none());
        assert!(base64_decode("Z===").is_none());
        assert!(base64_decode("Zg==Zg==").is_none());
        assert!(base64_decode("Zm9*").is_none());
    }
}
