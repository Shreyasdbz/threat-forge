#[allow(dead_code)]
#[path = "../../src-tauri/src/models/threat_model.rs"]
mod models;
#[path = "../../src-tauri/src/scene.rs"]
mod scene;
#[path = "../../src-tauri/src/importers/tm7.rs"]
mod tm7;

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn import_tm7(source: &str) -> Result<String, JsError> {
    let invalid = || JsError::new("Could not import the selected .tm7 file.");
    let model = tm7::parse_tm7(source).map_err(|_| invalid())?;
    serde_json::to_string(&model).map_err(|_| invalid())
}

fn parse_model(model: &str) -> Result<models::ThreatModel, JsError> {
    let invalid = |_| JsError::new("Invalid diagram model.");
    let mut value: serde_json::Value = serde_json::from_str(model).map_err(invalid)?;
    if value.get("version").and_then(serde_json::Value::as_str) != Some("1.1") {
        if let Some(diagrams) = value
            .get_mut("diagrams")
            .and_then(serde_json::Value::as_array_mut)
        {
            for diagram in diagrams
                .iter_mut()
                .filter_map(serde_json::Value::as_object_mut)
            {
                diagram.remove("sequence");
            }
        }
    }
    serde_json::from_value(value).map_err(invalid)
}

#[wasm_bindgen]
pub fn render_svg(model: &str, diagram_id: Option<String>) -> Result<String, JsError> {
    scene::Scene::select(&parse_model(model)?, diagram_id.as_deref())
        .and_then(|scene| scene.svg())
        .map_err(JsError::new)
}

#[wasm_bindgen]
pub fn render_png(model: &str, diagram_id: Option<String>) -> Result<Vec<u8>, JsError> {
    scene::Scene::select(&parse_model(model)?, diagram_id.as_deref())
        .and_then(|scene| scene.png())
        .map_err(JsError::new)
}
