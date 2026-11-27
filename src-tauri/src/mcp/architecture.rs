use crate::models::{Relationship, ThreatModel};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct ArchitectureId {
    id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct AddRelationship {
    id: String,
    #[serde(rename = "type")]
    kind: String,
    from: String,
    to: String,
    name: Option<String>,
    description: Option<String>,
    stroke_color: Option<String>,
    stroke_opacity: Option<f64>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct UpdateRelationship {
    id: String,
    #[serde(rename = "type")]
    kind: Option<String>,
    from: Option<String>,
    to: Option<String>,
    name: Option<String>,
    description: Option<String>,
    stroke_color: Option<String>,
    stroke_opacity: Option<f64>,
}

fn nonblank(value: &str, field: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{field} must not be blank."));
    }
    Ok(())
}

fn check_stroke(color: Option<&str>, opacity: Option<f64>) -> Result<(), String> {
    if let Some(color) = color {
        if !color
            .strip_prefix('#')
            .is_some_and(|hex| hex.len() == 6 && hex.bytes().all(|byte| byte.is_ascii_hexdigit()))
        {
            return Err("stroke_color must be a #RRGGBB color.".into());
        }
    }
    if opacity.is_some_and(|value| !(0.0..=1.0).contains(&value)) {
        return Err("stroke_opacity must be between 0 and 1.".into());
    }
    Ok(())
}

fn index<T>(
    items: &[T],
    id: &str,
    kind: &str,
    get_id: impl Fn(&T) -> &str,
) -> Result<usize, String> {
    items
        .iter()
        .position(|item| get_id(item) == id)
        .ok_or_else(|| format!("{kind} not found: {id}."))
}

fn outcome(action: &str, id: &str) -> Value {
    json!({ "action": action, "id": id })
}

impl AddRelationship {
    pub(super) fn apply(self, model: &mut ThreatModel) -> Result<Value, String> {
        nonblank(&self.id, "id")?;
        nonblank(&self.kind, "type")?;
        if let Some(name) = &self.name {
            nonblank(name, "name")?;
        }
        check_stroke(self.stroke_color.as_deref(), self.stroke_opacity)?;
        let result = outcome("add_relationship", &self.id);
        model.relationships.push(Relationship {
            id: self.id,
            relationship_type: self.kind,
            from: self.from,
            to: self.to,
            name: self.name,
            description: self.description,
            source_handle: None,
            target_handle: None,
            label_offset: None,
            stroke_color: self.stroke_color,
            stroke_opacity: self.stroke_opacity,
        });
        Ok(result)
    }
}

impl UpdateRelationship {
    pub(super) fn apply(self, model: &mut ThreatModel) -> Result<Value, String> {
        let index = index(&model.relationships, &self.id, "Relationship", |item| {
            &item.id
        })?;
        check_stroke(self.stroke_color.as_deref(), self.stroke_opacity)?;
        let item = &mut model.relationships[index];
        if let Some(kind) = self.kind {
            nonblank(&kind, "type")?;
            item.relationship_type = kind;
        }
        if let Some(from) = self.from {
            if item.from != from {
                item.source_handle = None;
                item.from = from;
            }
        }
        if let Some(to) = self.to {
            if item.to != to {
                item.target_handle = None;
                item.to = to;
            }
        }
        if let Some(name) = self.name {
            nonblank(&name, "name")?;
            item.name = Some(name);
        }
        if let Some(description) = self.description {
            item.description = Some(description);
        }
        if let Some(color) = self.stroke_color {
            item.stroke_color = Some(color);
        }
        if let Some(opacity) = self.stroke_opacity {
            item.stroke_opacity = Some(opacity);
        }
        Ok(outcome("update_relationship", &self.id))
    }
}

impl ArchitectureId {
    pub(super) fn delete_relationship(self, model: &mut ThreatModel) -> Result<Value, String> {
        let index = index(&model.relationships, &self.id, "Relationship", |item| {
            &item.id
        })?;
        model.relationships.remove(index);
        Ok(outcome("delete_relationship", &self.id))
    }
}
