use threat_forge_lib::{markdown, models::ThreatModel};

const CHECKOUT: &str = include_str!("../../tests/fixtures/markdown/checkout.thf");
const GOLDEN: &str = include_str!("../../tests/fixtures/markdown/checkout.md");

#[test]
fn checkout_golden_is_independent_of_storage_order_and_dates() {
    let mut model: ThreatModel = serde_yaml::from_str(CHECKOUT).unwrap();
    assert_eq!(markdown::review(&model), GOLDEN);
    model.elements.reverse();
    model.data_flows.reverse();
    model.threats.reverse();
    model.metadata.created = model.metadata.created.succ_opt().unwrap();
    model.metadata.modified = model.metadata.modified.succ_opt().unwrap();
    assert_eq!(markdown::review(&model), GOLDEN);
}

#[test]
fn empty_review_has_explicit_sections() {
    assert_eq!(
        markdown::review(&ThreatModel::new("Empty architecture", "")),
        include_str!("../../tests/fixtures/markdown/empty.md")
    );
}

#[test]
fn flow_data_labels_keep_their_boundaries() {
    let mut model: ThreatModel = serde_yaml::from_str(CHECKOUT).unwrap();
    let flow = model
        .data_flows
        .iter_mut()
        .find(|f| !f.data.is_empty())
        .unwrap();
    flow.data = vec![
        "Name".into(),
        "email".into(),
        "Order `record`".into(),
        "".into(),
    ];
    let review = markdown::review(&model);
    assert_ne!(review, GOLDEN);
    assert!(review.contains("  - Data: `Name`, `email`, `` Order `record` ``, *(empty)*\n"));
}

#[test]
fn hostile_text_golden_is_literal() {
    let model =
        serde_yaml::from_str(include_str!("../../tests/fixtures/markdown/hostile.thf")).unwrap();
    assert_eq!(
        markdown::review(&model),
        include_str!("../../tests/fixtures/markdown/hostile.md")
    );
}
