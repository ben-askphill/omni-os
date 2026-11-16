//! JavaScript's number formatting where Rust's differs: `Math.round` rounds a half up, and `toFixed` rounds the
//! exact value of the double with ties going away from zero.

pub use omni_core::js::number_to_string as num;

/// `Math.round`.
pub fn round(x: f64) -> f64 {
    if !x.is_finite() {
        return x;
    }
    let floor = x.floor();
    if x - floor >= 0.5 { floor + 1.0 } else { floor }
}

/// `x.toFixed(digits)` for up to two digits, which is all this command prints.
pub fn to_fixed(x: f64, digits: u32) -> String {
    assert!(digits <= 2, "to_fixed is exact for up to two digits");
    if x.is_nan() {
        return "NaN".to_string();
    }
    if x.abs() >= 1e21 {
        return num(x);
    }
    let negative = x < 0.0;
    // The double is mantissa * 2^exponent exactly, so the tie test below is exact too.
    let bits = x.abs().to_bits();
    let biased = ((bits >> 52) & 0x7ff) as i32;
    let fraction = bits & ((1u64 << 52) - 1);
    let (mantissa, exponent) = if biased == 0 { (fraction, -1074) } else { (fraction | (1u64 << 52), biased - 1075) };
    let scaled = u128::from(mantissa) * 10u128.pow(digits);
    let n = if exponent >= 0 {
        scaled << exponent
    } else {
        let shift = (-exponent) as u32;
        if shift >= 127 {
            0
        } else {
            let whole = scaled >> shift;
            let rest = scaled & ((1u128 << shift) - 1);
            whole + u128::from(rest >= (1u128 << (shift - 1)))
        }
    };
    let mut text = n.to_string();
    if digits > 0 {
        let digits = digits as usize;
        while text.len() <= digits {
            text.insert(0, '0');
        }
        text.insert(text.len() - digits, '.');
    }
    if negative { format!("-{text}") } else { text }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rounds_a_half_up() {
        assert_eq!(round(2.5), 3.0);
        assert_eq!(round(-2.5), -2.0);
        assert_eq!(round(0.499_999_999_999_999_94), 0.0);
        assert_eq!(round(1.4), 1.0);
        assert_eq!(num(round(-0.2)), "0");
        assert!(round(f64::NAN).is_nan());
    }

    #[test]
    fn fixes_digits_as_javascript_does() {
        assert_eq!(to_fixed(0.25, 1), "0.3");
        assert_eq!(to_fixed(1.005, 2), "1.00");
        assert_eq!(to_fixed(2.5, 0), "3");
        assert_eq!(to_fixed(-0.001, 2), "-0.00");
        assert_eq!(to_fixed(-0.0, 2), "0.00");
        assert_eq!(to_fixed(1.0, 1), "1.0");
        assert_eq!(to_fixed(9.96, 1), "10.0");
        assert_eq!(to_fixed(1e21, 2), "1e+21");
        assert_eq!(to_fixed(f64::NAN, 2), "NaN");
    }
}
