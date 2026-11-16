//! Free disk space in words, and when it is too little (`packages/shared/disk-space.ts`).

use crate::num::{num, round, to_fixed};

const GB: f64 = 1024.0 * 1024.0 * 1024.0;
const MB: f64 = 1024.0 * 1024.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiskLevel {
    Ok,
    Low,
    Critical,
}

/// Low below 20 GB free, critical below 5 GB, each capped at a share of the disk (15% and 5%) so a small volume
/// warns at a few GB, not as soon as it is a quarter used.
pub fn disk_level(free: f64, total: f64) -> DiskLevel {
    let under = |bytes: f64, share: f64| free < bytes.min(total * share);
    if under(5.0 * GB, 0.05) {
        DiskLevel::Critical
    } else if under(20.0 * GB, 0.15) {
        DiskLevel::Low
    } else {
        DiskLevel::Ok
    }
}

/// "12 GB", "1.5 GB", "850 MB".
pub fn free_size(bytes: f64) -> String {
    if bytes >= 10.0 * GB {
        format!("{} GB", num(round(bytes / GB)))
    } else if bytes >= GB {
        format!("{} GB", to_fixed(bytes / GB, 1))
    } else {
        // `Math.max(0, NaN)` is NaN, and a size that is no number prints as one.
        let mb = round(bytes / MB);
        format!("{} MB", num(if mb < 0.0 { 0.0 } else { mb }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn words_a_size() {
        assert_eq!(free_size(12.4 * GB), "12 GB");
        assert_eq!(free_size(10.0 * GB), "10 GB");
        assert_eq!(free_size(9.96 * GB), "10.0 GB");
        assert_eq!(free_size(1.5 * GB), "1.5 GB");
        assert_eq!(free_size(GB - 1.0), "1024 MB");
        assert_eq!(free_size(850.0 * MB), "850 MB");
        assert_eq!(free_size(0.0), "0 MB");
        assert_eq!(free_size(-5.0 * MB), "0 MB");
        assert_eq!(free_size(f64::NAN), "NaN MB");
    }

    #[test]
    fn grades_free_space() {
        assert_eq!(disk_level(100.0 * GB, 500.0 * GB), DiskLevel::Ok);
        assert_eq!(disk_level(19.0 * GB, 500.0 * GB), DiskLevel::Low);
        assert_eq!(disk_level(4.0 * GB, 500.0 * GB), DiskLevel::Critical);
        // A 26 GB volume warns below 3.9 GB and is critical below 1.3 GB.
        assert_eq!(disk_level(4.0 * GB, 26.0 * GB), DiskLevel::Ok);
        assert_eq!(disk_level(3.0 * GB, 26.0 * GB), DiskLevel::Low);
        assert_eq!(disk_level(1.0 * GB, 26.0 * GB), DiskLevel::Critical);
    }
}
