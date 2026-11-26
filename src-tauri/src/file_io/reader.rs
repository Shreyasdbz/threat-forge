use crate::errors::ThreatForgeError;
use crate::models::{DiagramLayout, Position, Size, ThreatModel};
use std::collections::HashMap;
use std::path::Path;

/// Read and parse a `.thf` file
#[cfg(test)]
pub fn read_threat_model(path: &Path) -> Result<ThreatModel, ThreatForgeError> {
    super::read_document(path).map(|snapshot| snapshot.model)
}

pub(crate) fn validate_model(model: &ThreatModel) -> Result<(), ThreatForgeError> {
    validate_version(&model.version)?;
    validate_references(model)?;
    match model.version.as_str() {
        "1.1" => validate_sequences(model),
        _ if model
            .diagrams
            .iter()
            .any(|diagram| diagram.sequence.is_some()) =>
        {
            Err(invalid_sequence(
                "diagrams[].sequence",
                "requires version 1.1",
            ))
        }
        _ => Ok(()),
    }
}

/// Migrate old-format models that use sidecar layout JSON files.
///
/// Detects diagrams with `layout_file: Some(...)` and `viewport: None`,
/// reads the sidecar JSON, and merges positions into inline model fields.
/// Failures are non-fatal — missing layout files are silently skipped.
#[cfg(test)]
pub fn merge_layout_into_model(model: &mut ThreatModel, model_path: &Path) {
    let parent = model_path.parent().unwrap().canonicalize().unwrap();
    let target =
        super::WriteTarget::from_path(&parent.join(model_path.file_name().unwrap())).unwrap();
    target.read_layouts(model).merge_into(model);
}

#[derive(Default, serde::Serialize)]
pub(crate) struct LegacyLayouts(Vec<(String, String, Option<DiagramLayout>)>);

impl LegacyLayouts {
    pub(crate) fn capture(
        model: &ThreatModel,
        mut read: impl FnMut(&Path) -> Option<DiagramLayout>,
    ) -> Self {
        Self(
            model
                .diagrams
                .iter()
                .filter_map(|diagram| {
                    let (Some(layout_file), None) = (&diagram.layout_file, &diagram.viewport)
                    else {
                        return None;
                    };
                    let layout = read(Path::new(layout_file));
                    Some((diagram.id.clone(), layout_file.clone(), layout))
                })
                .collect(),
        )
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub(crate) fn has_unavailable(&self) -> bool {
        self.0.iter().any(|(_, _, layout)| layout.is_none())
    }

    pub fn merge_into(&self, model: &mut ThreatModel) {
        for (id, path, layout) in &self.0 {
            let Some(diagram) = model.diagrams.iter_mut().find(|diagram| {
                diagram.id == *id
                    && diagram.layout_file.as_ref() == Some(path)
                    && diagram.viewport.is_none()
            }) else {
                continue;
            };
            let Some(layout) = layout else { continue };

            // Build lookup from node ID to position data
            let positions: HashMap<&str, _> =
                layout.nodes.iter().map(|n| (n.id.as_str(), n)).collect();

            // Merge positions into elements
            for element in &mut model.elements {
                if let Some(np) = positions.get(element.id.as_str()) {
                    if element.position.is_none() {
                        element.position = Some(Position { x: np.x, y: np.y });
                    }
                }
            }

            // Merge positions and sizes into trust boundaries
            for boundary in &mut model.trust_boundaries {
                if let Some(np) = positions.get(boundary.id.as_str()) {
                    if boundary.position.is_none() {
                        boundary.position = Some(Position { x: np.x, y: np.y });
                    }
                    if boundary.size.is_none() {
                        if let (Some(w), Some(h)) = (np.width, np.height) {
                            boundary.size = Some(Size {
                                width: w,
                                height: h,
                            });
                        }
                    }
                }
            }

            // Set diagram viewport from layout
            diagram.viewport = Some(layout.viewport.clone());
        }
    }
}

/// Validate the schema version is supported
fn validate_version(version: &str) -> Result<(), ThreatForgeError> {
    match version {
        "1.0" | "1.1" => Ok(()),
        _ => Err(ThreatForgeError::UnsupportedVersion {
            version: version.to_string(),
            supported: vec!["1.0".to_string(), "1.1".to_string()],
        }),
    }
}

/// Validate cross-references within the model
fn validate_references(model: &ThreatModel) -> Result<(), ThreatForgeError> {
    let element_ids: Vec<&str> = model.elements.iter().map(|e| e.id.as_str()).collect();
    let flow_ids: Vec<&str> = model.data_flows.iter().map(|f| f.id.as_str()).collect();
    let layer_ids: Vec<&str> = model.layers.iter().map(|l| l.id.as_str()).collect();
    let group_ids: Vec<&str> = model.groups.iter().map(|g| g.id.as_str()).collect();
    let relationship_ids: Vec<&str> = model.relationships.iter().map(|r| r.id.as_str()).collect();
    let boundary_ids: Vec<&str> = model
        .trust_boundaries
        .iter()
        .map(|b| b.id.as_str())
        .collect();

    // Check for duplicate element IDs
    let mut seen = std::collections::HashSet::new();
    for id in &element_ids {
        if !seen.insert(id) {
            return Err(ThreatForgeError::DuplicateId {
                id: id.to_string(),
                section: "elements".to_string(),
            });
        }
    }

    // Check for duplicate flow IDs
    seen.clear();
    for id in &flow_ids {
        if !seen.insert(id) {
            return Err(ThreatForgeError::DuplicateId {
                id: id.to_string(),
                section: "data_flows".to_string(),
            });
        }
    }

    // Check for duplicate layer IDs
    seen.clear();
    for id in &layer_ids {
        if !seen.insert(id) {
            return Err(ThreatForgeError::DuplicateId {
                id: id.to_string(),
                section: "layers".to_string(),
            });
        }
    }

    // Check for duplicate group IDs
    seen.clear();
    for id in &group_ids {
        if !seen.insert(id) {
            return Err(ThreatForgeError::DuplicateId {
                id: id.to_string(),
                section: "groups".to_string(),
            });
        }
    }

    // Check for duplicate relationship IDs
    seen.clear();
    for id in &relationship_ids {
        if !seen.insert(id) {
            return Err(ThreatForgeError::DuplicateId {
                id: id.to_string(),
                section: "relationships".to_string(),
            });
        }
    }

    // Namespace collisions, scoped to the new sections so no pre-existing file is invalidated.
    // Groups share the ReactFlow node ID space with elements and trust boundaries.
    for group in &model.groups {
        let gid = group.id.as_str();
        if element_ids.contains(&gid) || boundary_ids.contains(&gid) {
            return Err(ThreatForgeError::DuplicateId {
                id: gid.to_string(),
                section: "groups".to_string(),
            });
        }
    }

    // Relationships share the edge ID space with data flows.
    for id in &relationship_ids {
        if flow_ids.contains(id) {
            return Err(ThreatForgeError::DuplicateId {
                id: id.to_string(),
                section: "relationships".to_string(),
            });
        }
    }

    // Validate data flow references point to existing elements
    for flow in &model.data_flows {
        if !element_ids.contains(&flow.from.as_str()) {
            return Err(ThreatForgeError::InvalidReference {
                field: format!("data_flows[{}].from", flow.id),
                reference: flow.from.clone(),
                valid: element_ids.iter().map(|s| s.to_string()).collect(),
            });
        }
        if !element_ids.contains(&flow.to.as_str()) {
            return Err(ThreatForgeError::InvalidReference {
                field: format!("data_flows[{}].to", flow.id),
                reference: flow.to.clone(),
                valid: element_ids.iter().map(|s| s.to_string()).collect(),
            });
        }
    }

    // Validate element layer and group membership references
    for element in &model.elements {
        if let Some(layer) = &element.layer {
            if !layer_ids.contains(&layer.as_str()) {
                return Err(ThreatForgeError::InvalidReference {
                    field: format!("elements[{}].layer", element.id),
                    reference: layer.clone(),
                    valid: layer_ids.iter().map(|s| s.to_string()).collect(),
                });
            }
        }
        if let Some(group) = &element.group {
            if !group_ids.contains(&group.as_str()) {
                return Err(ThreatForgeError::InvalidReference {
                    field: format!("elements[{}].group", element.id),
                    reference: group.clone(),
                    valid: group_ids.iter().map(|s| s.to_string()).collect(),
                });
            }
        }
    }

    // Validate group parent references
    for group in &model.groups {
        if let Some(parent) = &group.parent {
            if !group_ids.contains(&parent.as_str()) {
                return Err(ThreatForgeError::InvalidReference {
                    field: format!("groups[{}].parent", group.id),
                    reference: parent.clone(),
                    valid: group_ids.iter().map(|s| s.to_string()).collect(),
                });
            }
        }
    }

    // Validate relationship endpoints. Endpoints are element IDs only, matching `data_flows`.
    for relationship in &model.relationships {
        if !element_ids.contains(&relationship.from.as_str()) {
            return Err(ThreatForgeError::InvalidReference {
                field: format!("relationships[{}].from", relationship.id),
                reference: relationship.from.clone(),
                valid: element_ids.iter().map(|s| s.to_string()).collect(),
            });
        }
        if !element_ids.contains(&relationship.to.as_str()) {
            return Err(ThreatForgeError::InvalidReference {
                field: format!("relationships[{}].to", relationship.id),
                reference: relationship.to.clone(),
                valid: element_ids.iter().map(|s| s.to_string()).collect(),
            });
        }
    }

    // Detect circular group nesting, including self-parenting. Parents are already validated to
    // exist, so the traversal is bounded by the number of groups. Iterative with a visited set:
    // no recursion and no `unwrap`.
    let parent_of: HashMap<&str, &str> = model
        .groups
        .iter()
        .filter_map(|g| g.parent.as_deref().map(|p| (g.id.as_str(), p)))
        .collect();
    for group in &model.groups {
        let mut visited = std::collections::HashSet::new();
        let mut current = group.id.as_str();
        visited.insert(current);
        while let Some(&parent) = parent_of.get(current) {
            if !visited.insert(parent) {
                return Err(ThreatForgeError::CircularGroupNesting {
                    id: parent.to_string(),
                });
            }
            current = parent;
        }
    }

    // Validate trust boundary references
    for boundary in &model.trust_boundaries {
        for contained in &boundary.contains {
            if !element_ids.contains(&contained.as_str()) {
                return Err(ThreatForgeError::InvalidReference {
                    field: format!("trust_boundaries[{}].contains", boundary.id),
                    reference: contained.clone(),
                    valid: element_ids.iter().map(|s| s.to_string()).collect(),
                });
            }
        }
    }

    // Validate threat references
    for threat in &model.threats {
        if let Some(ref element) = threat.element {
            if !element_ids.contains(&element.as_str()) {
                return Err(ThreatForgeError::InvalidReference {
                    field: format!("threats[{}].element", threat.id),
                    reference: element.clone(),
                    valid: element_ids.iter().map(|s| s.to_string()).collect(),
                });
            }
        }
        if let Some(ref flow) = threat.flow {
            if !flow_ids.contains(&flow.as_str()) {
                return Err(ThreatForgeError::InvalidReference {
                    field: format!("threats[{}].flow", threat.id),
                    reference: flow.clone(),
                    valid: flow_ids.iter().map(|s| s.to_string()).collect(),
                });
            }
        }
    }

    Ok(())
}

fn validate_sequences(model: &ThreatModel) -> Result<(), ThreatForgeError> {
    let elements: Vec<_> = model
        .elements
        .iter()
        .map(|element| element.id.as_str())
        .collect();
    let flows: HashMap<_, _> = model
        .data_flows
        .iter()
        .map(|flow| (flow.id.as_str(), flow))
        .collect();
    for (index, diagram) in model.diagrams.iter().enumerate() {
        let Some(sequence) = &diagram.sequence else {
            continue;
        };
        let path = format!("diagrams[{}].sequence", diagram.id);
        if diagram.kind.as_deref() != Some("sequence") {
            return Err(invalid_sequence(&path, "requires kind: sequence"));
        }
        require_sequence_id(&diagram.id, || format!("diagrams[{index}].id"))?;
        validate_unique(
            model
                .diagrams
                .iter()
                .filter(|entry| entry.id == diagram.id)
                .map(|entry| entry.id.as_str()),
            "diagrams",
        )?;
        for (i, participant) in sequence.participants.iter().enumerate() {
            require_sequence_id(&participant.id, || format!("{path}.participants[{i}].id"))?;
        }
        let participant_ids: Vec<_> = sequence
            .participants
            .iter()
            .map(|participant| participant.id.as_str())
            .collect();
        validate_unique(
            participant_ids.iter().copied(),
            &format!("{path}.participants"),
        )?;
        validate_unique(
            sequence
                .participants
                .iter()
                .map(|participant| participant.element_id.as_str()),
            &format!("{path}.participants.element_id"),
        )?;
        let mut endpoints = HashMap::new();
        for participant in &sequence.participants {
            require_sequence_reference(&participant.element_id, &elements, || {
                format!("{path}.participants[{}].element_id", participant.id)
            })?;
            endpoints.insert(participant.id.as_str(), participant.element_id.as_str());
        }
        for (i, message) in sequence.messages.iter().enumerate() {
            require_sequence_id(&message.id, || format!("{path}.messages[{i}].id"))?;
        }
        validate_unique(
            sequence.messages.iter().map(|message| message.id.as_str()),
            &format!("{path}.messages"),
        )?;
        for message in &sequence.messages {
            let field = format!("{path}.messages[{}]", message.id);
            require_sequence_reference(&message.from, &participant_ids, || {
                format!("{field}.from")
            })?;
            require_sequence_reference(&message.to, &participant_ids, || format!("{field}.to"))?;
            if let Some(id) = &message.flow_id {
                let Some(flow) = flows.get(id.as_str()) else {
                    return Err(ThreatForgeError::InvalidReference {
                        field: format!("{field}.flow_id"),
                        reference: id.clone(),
                        valid: model
                            .data_flows
                            .iter()
                            .map(|flow| flow.id.clone())
                            .collect(),
                    });
                };
                if endpoints.get(message.from.as_str()) != Some(&flow.from.as_str())
                    || endpoints.get(message.to.as_str()) != Some(&flow.to.as_str())
                {
                    return Err(invalid_sequence(
                        &format!("{field}.flow_id"),
                        "flow endpoints must match message direction",
                    ));
                }
            }
        }
    }
    Ok(())
}

fn invalid_sequence(field: &str, reason: &'static str) -> ThreatForgeError {
    ThreatForgeError::InvalidSequence {
        field: field.into(),
        reason,
    }
}

fn require_sequence_id(id: &str, field: impl FnOnce() -> String) -> Result<(), ThreatForgeError> {
    if id.trim().is_empty() {
        return Err(invalid_sequence(&field(), "ID must not be blank"));
    }
    Ok(())
}

fn require_sequence_reference(
    id: &str,
    valid: &[&str],
    field: impl FnOnce() -> String,
) -> Result<(), ThreatForgeError> {
    if !valid.contains(&id) {
        return Err(ThreatForgeError::InvalidReference {
            field: field(),
            reference: id.into(),
            valid: valid.iter().map(|id| (*id).into()).collect(),
        });
    }
    Ok(())
}

fn validate_unique<'a>(
    ids: impl IntoIterator<Item = &'a str>,
    section: &str,
) -> Result<(), ThreatForgeError> {
    let mut seen = std::collections::HashSet::new();
    for id in ids {
        if !seen.insert(id) {
            return Err(ThreatForgeError::DuplicateId {
                id: id.into(),
                section: section.into(),
            });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Viewport;
    use std::io::Write;
    use tempfile::{NamedTempFile, TempDir};

    fn write_temp_yaml(content: &str) -> NamedTempFile {
        let mut file = NamedTempFile::new().unwrap();
        file.write_all(content.as_bytes()).unwrap();
        file
    }

    #[test]
    fn test_read_valid_threat_model() {
        let yaml = r#"
version: "1.0"
metadata:
  title: "Test Model"
  author: "Test"
  created: 2026-03-15
  modified: 2026-03-15
elements:
  - id: app
    type: process
    name: "Application"
data_flows: []
trust_boundaries: []
threats: []
diagrams:
  - id: main-dfd
    name: "Level 0 DFD"
    layout_file: ".threatforge/layouts/main-dfd.json"
"#;
        let file = write_temp_yaml(yaml);
        let model = read_threat_model(file.path()).unwrap();
        assert_eq!(model.metadata.title, "Test Model");
        assert_eq!(model.elements.len(), 1);
    }

    #[test]
    fn test_rejects_unsupported_version() {
        let yaml = r#"
version: "2.0"
metadata:
  title: "Test"
  author: "Test"
  created: 2026-03-15
  modified: 2026-03-15
"#;
        let file = write_temp_yaml(yaml);
        let result = read_threat_model(file.path());
        assert!(result.is_err());
        assert!(
            result.unwrap_err().to_string().contains("Unsupported"),
            "Error should mention unsupported version"
        );
    }

    #[test]
    fn test_rejects_duplicate_element_ids() {
        let yaml = r#"
version: "1.0"
metadata:
  title: "Test"
  author: "Test"
  created: 2026-03-15
  modified: 2026-03-15
elements:
  - id: app
    type: process
    name: "App 1"
  - id: app
    type: process
    name: "App 2"
"#;
        let file = write_temp_yaml(yaml);
        let result = read_threat_model(file.path());
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Duplicate"));
    }

    #[test]
    fn test_merge_layout_into_model() {
        let dir = TempDir::new().unwrap();
        let model_path = dir.path().join("test.thf");
        let layout_dir = dir.path().join(".threatforge/layouts");
        std::fs::create_dir_all(&layout_dir).unwrap();

        // Write a YAML model with old-style layout_file reference
        let yaml = r#"
version: "1.0"
metadata:
  title: "Migration Test"
  author: "Test"
  created: 2026-03-15
  modified: 2026-03-15
elements:
  - id: web-app
    type: process
    name: "Web App"
  - id: db
    type: data_store
    name: "Database"
trust_boundaries:
  - id: boundary-1
    name: "Internal"
    contains: [web-app, db]
diagrams:
  - id: main-dfd
    name: "Level 0 DFD"
    layout_file: ".threatforge/layouts/main-dfd.json"
"#;
        std::fs::write(&model_path, yaml).unwrap();

        // Write matching layout JSON
        let layout_json = r#"{
  "diagram_id": "main-dfd",
  "viewport": { "x": 10.0, "y": 20.0, "zoom": 1.5 },
  "nodes": [
    { "id": "web-app", "x": 100.0, "y": 200.0 },
    { "id": "db", "x": 300.0, "y": 400.0 },
    { "id": "boundary-1", "x": 50.0, "y": 50.0, "width": 600.0, "height": 500.0 }
  ]
}"#;
        std::fs::write(layout_dir.join("main-dfd.json"), layout_json).unwrap();

        let mut model = read_threat_model(&model_path).unwrap();
        merge_layout_into_model(&mut model, &model_path);

        // Verify element positions were merged
        assert_eq!(
            model.elements[0].position,
            Some(Position { x: 100.0, y: 200.0 }),
            "web-app position should be merged from layout"
        );
        assert_eq!(
            model.elements[1].position,
            Some(Position { x: 300.0, y: 400.0 }),
            "db position should be merged from layout"
        );

        // Verify boundary position and size
        assert_eq!(
            model.trust_boundaries[0].position,
            Some(Position { x: 50.0, y: 50.0 })
        );
        assert_eq!(
            model.trust_boundaries[0].size,
            Some(Size {
                width: 600.0,
                height: 500.0
            })
        );

        // Verify viewport was set on diagram
        assert_eq!(
            model.diagrams[0].viewport,
            Some(Viewport {
                x: 10.0,
                y: 20.0,
                zoom: 1.5
            })
        );
    }

    #[test]
    fn test_merge_layout_skips_when_no_layout_file() {
        let dir = TempDir::new().unwrap();
        let model_path = dir.path().join("test.thf");

        // Write a model without layout_file (new format)
        let yaml = r#"
version: "1.0"
metadata:
  title: "New Format"
  author: "Test"
  created: 2026-03-15
  modified: 2026-03-15
elements:
  - id: app
    type: process
    name: "App"
    position:
      x: 50.0
      y: 60.0
diagrams:
  - id: main-dfd
    name: "Level 0 DFD"
    viewport:
      x: 0.0
      y: 0.0
      zoom: 1.0
"#;
        std::fs::write(&model_path, yaml).unwrap();

        let mut model = read_threat_model(&model_path).unwrap();
        merge_layout_into_model(&mut model, &model_path);

        // Position should remain unchanged (not overwritten)
        assert_eq!(
            model.elements[0].position,
            Some(Position { x: 50.0, y: 60.0 })
        );
    }

    #[test]
    fn test_rejects_invalid_flow_reference() {
        let yaml = r#"
version: "1.0"
metadata:
  title: "Test"
  author: "Test"
  created: 2026-03-15
  modified: 2026-03-15
elements:
  - id: app
    type: process
    name: "App"
data_flows:
  - id: flow-1
    from: app
    to: nonexistent
    protocol: HTTPS
"#;
        let file = write_temp_yaml(yaml);
        let result = read_threat_model(file.path());
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Invalid reference"));
    }

    #[test]
    fn test_rejects_self_parenting_group() {
        // Self-parenting is a one-node cycle and must be caught by the same visited-set traversal.
        let yaml = r#"
version: "1.0"
metadata:
  title: "Self Parent"
  author: "Test"
  created: 2026-03-15
  modified: 2026-03-15
groups:
  - id: cluster-1
    name: "Cluster"
    parent: cluster-1
"#;
        let file = write_temp_yaml(yaml);
        match read_threat_model(file.path()).expect_err("self-parenting must be rejected") {
            ThreatForgeError::CircularGroupNesting { id } => assert_eq!(id, "cluster-1"),
            other => panic!("expected CircularGroupNesting, got {other:?}"),
        }
    }

    #[test]
    fn test_accepts_valid_architecture_graph() {
        // A consistent architecture graph — nested groups, layered elements, and a typed
        // relationship — must read without error. This is the counterpart to the invalid corpus.
        let yaml = r#"
version: "1.0"
metadata:
  title: "Architecture Graph"
  author: "Test"
  created: 2026-03-15
  modified: 2026-03-15
layers:
  - id: presentation
    name: "Presentation"
  - id: data
    name: "Data"
groups:
  - id: backend
    name: "Backend"
  - id: api
    name: "API"
    parent: backend
elements:
  - id: web-app
    type: process
    name: "Web App"
    layer: presentation
    group: api
  - id: orders-db
    type: data_store
    name: "Orders DB"
    layer: data
    group: backend
relationships:
  - id: rel-1
    type: depends_on
    from: web-app
    to: orders-db
"#;
        let file = write_temp_yaml(yaml);
        let model = read_threat_model(file.path()).expect("valid architecture graph must read");
        assert_eq!(model.layers.len(), 2);
        assert_eq!(model.groups.len(), 2);
        assert_eq!(model.relationships.len(), 1);
    }
}
