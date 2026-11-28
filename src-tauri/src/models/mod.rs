mod threat_model;

pub use threat_model::*;
use uuid::Uuid;

/// Generate a unique threat ID
pub fn generate_threat_id() -> String {
    format!(
        "threat-{}",
        Uuid::new_v4()
            .as_simple()
            .to_string()
            .get(..8)
            .unwrap_or("00000000")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_threat_id() {
        let id = generate_threat_id();
        assert!(id.starts_with("threat-"));
        assert_eq!(id.len(), 15); // "threat-" (7) + 8 hex chars
    }
}
